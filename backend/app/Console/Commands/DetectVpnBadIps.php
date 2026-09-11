<?php

namespace App\Console\Commands;

use App\Services\VpnIpBlocklistPolicy;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

class DetectVpnBadIps extends Command
{
    protected $signature = 'funnel-analysis:detect-vpn-bad-ips
        {--project-code=A040 : 项目代号}
        {--lookback-minutes=60 : 回看分钟数}
        {--dry-run : 只输出候选，不写入候选表}';

    protected $description = 'Detect configurable Firebase internal_error exit-IP suspect/blocklist candidates';

    public function handle(VpnIpBlocklistPolicy $policy): int
    {
        $projectCode = trim((string) $this->option('project-code')) ?: 'A040';
        $lookbackMinutes = max(5, min(1440, (int) $this->option('lookback-minutes')));
        $this->createTables();
        $rule = $this->ruleForProject($projectCode);
        $metrics = $this->loadIpMetrics($projectCode, $lookbackMinutes);
        $now = Carbon::now('UTC');
        $decisions = [];

        foreach ($metrics as $row) {
            $decision = $policy->evaluate($rule, (array) $row);
            if ($decision['level'] === 'none') {
                continue;
            }
            $expiresAt = $now->copy()->addMinutes($decision['ttl_minutes']);
            $record = [
                'project_code' => $projectCode,
                'ip_after_connect' => (string) $row->ip_after_connect,
                'level' => $decision['level'],
                'reason' => $decision['reason'],
                'request_sessions' => (int) $row->request_sessions,
                'success_sessions' => (int) $row->success_sessions,
                'internal_error_sessions' => (int) $row->internal_error_sessions,
                'internal_error_events' => (int) $row->internal_error_events,
                'error_session_rate' => $decision['error_session_rate'],
                'window_start_at' => $row->window_start_at,
                'window_end_at' => $row->window_end_at,
                'last_success_at' => $row->last_success_at,
                'last_error_at' => $row->last_error_at,
                'expires_at' => $expiresAt->toDateTimeString(),
                'updated_at' => $now->toDateTimeString(),
            ];
            $decisions[] = $record;
            if (!$this->option('dry-run')) {
                DB::table('jkcl_vpn_ip_blocklist_candidates')->updateOrInsert(
                    ['project_code' => $projectCode, 'ip_after_connect' => $record['ip_after_connect']],
                    $record + ['created_at' => $now->toDateTimeString()]
                );
            }
        }

        $this->info(sprintf(
            'vpn bad-ip detection project=%s window=%dmin candidates=%d dryRun=%s',
            $projectCode,
            $lookbackMinutes,
            count($decisions),
            $this->option('dry-run') ? 'yes' : 'no'
        ));
        foreach (array_slice($decisions, 0, 20) as $row) {
            $this->line(sprintf(
                '%s %-10s err=%d/%d rate=%.1f%% success=%d ttl=%smin',
                $row['ip_after_connect'],
                $row['level'],
                $row['internal_error_sessions'],
                $row['request_sessions'],
                $row['error_session_rate'] * 100,
                $row['success_sessions'],
                $rule[$row['level'] . '_ttl_minutes'] ?? $row['expires_at']
            ));
        }

        return self::SUCCESS;
    }

    private function createTables(): void
    {
        DB::statement(<<<'SQL'
CREATE TABLE IF NOT EXISTS jkcl_vpn_ip_blocklist_rules (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_code VARCHAR(32) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    min_request_sessions INT NOT NULL DEFAULT 5,
    suspect_min_request_sessions INT NOT NULL DEFAULT 5,
    suspect_min_error_sessions INT NOT NULL DEFAULT 3,
    suspect_min_error_rate DECIMAL(8,6) NOT NULL DEFAULT 0.500000,
    suspect_ttl_minutes INT NOT NULL DEFAULT 30,
    blocked_min_request_sessions INT NOT NULL DEFAULT 8,
    blocked_min_error_sessions INT NOT NULL DEFAULT 5,
    blocked_min_error_rate DECIMAL(8,6) NOT NULL DEFAULT 0.800000,
    blocked_max_success_sessions INT NOT NULL DEFAULT 0,
    blocked_ttl_minutes INT NOT NULL DEFAULT 60,
    hard_block_min_request_sessions INT NOT NULL DEFAULT 10,
    hard_block_min_error_sessions INT NOT NULL DEFAULT 8,
    hard_block_min_error_rate DECIMAL(8,6) NOT NULL DEFAULT 0.900000,
    hard_block_no_success_minutes INT NOT NULL DEFAULT 30,
    hard_block_ttl_minutes INT NOT NULL DEFAULT 360,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_jkcl_vpn_ip_blocklist_rules_project (project_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);

        DB::statement(<<<'SQL'
CREATE TABLE IF NOT EXISTS jkcl_vpn_ip_blocklist_candidates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_code VARCHAR(32) NOT NULL,
    ip_after_connect VARCHAR(64) NOT NULL,
    level VARCHAR(32) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    request_sessions INT NOT NULL DEFAULT 0,
    success_sessions INT NOT NULL DEFAULT 0,
    internal_error_sessions INT NOT NULL DEFAULT 0,
    internal_error_events INT NOT NULL DEFAULT 0,
    error_session_rate DECIMAL(8,6) NOT NULL DEFAULT 0,
    window_start_at DATETIME NULL,
    window_end_at DATETIME NULL,
    last_success_at DATETIME NULL,
    last_error_at DATETIME NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_jkcl_vpn_ip_blocklist_candidate (project_code, ip_after_connect),
    KEY idx_jkcl_vpn_ip_blocklist_level (project_code, level, expires_at),
    KEY idx_jkcl_vpn_ip_blocklist_error_rate (project_code, error_session_rate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);
    }

    /** @return array<string, mixed> */
    private function ruleForProject(string $projectCode): array
    {
        $existing = DB::table('jkcl_vpn_ip_blocklist_rules')->where('project_code', $projectCode)->first();
        if (!$existing) {
            DB::table('jkcl_vpn_ip_blocklist_rules')->insert(['project_code' => $projectCode]);
            $existing = DB::table('jkcl_vpn_ip_blocklist_rules')->where('project_code', $projectCode)->first();
        }
        return (array) $existing;
    }

    /** @return array<int, object> */
    private function loadIpMetrics(string $projectCode, int $lookbackMinutes): array
    {
        $table = (string) config('adb.tracking_events.event_table', 'dwd_app_tracking_event_v18');
        $since = Carbon::now('UTC')->subMinutes($lookbackMinutes)->toDateTimeString();
        $project = str_replace("'", "''", $projectCode);
        $source = str_replace('`', '``', $table);

        return DB::connection('adb')->select(<<<SQL
SELECT ip_after_connect,
    COUNT(DISTINCT session_id) AS request_sessions,
    COUNT(DISTINCT CASE WHEN success_events > 0 THEN session_id END) AS success_sessions,
    COUNT(DISTINCT CASE WHEN internal_error_events > 0 THEN session_id END) AS internal_error_sessions,
    SUM(internal_error_events) AS internal_error_events,
    MIN(first_seen_at) AS window_start_at,
    MAX(last_seen_at) AS window_end_at,
    MAX(success_at) AS last_success_at,
    MAX(error_at) AS last_error_at,
    CASE WHEN MAX(success_at) IS NULL THEN NULL ELSE TIMESTAMPDIFF(MINUTE, MAX(success_at), UTC_TIMESTAMP()) END AS last_success_age_minutes
FROM (
    SELECT r.ip_after_connect,
        r.session_id,
        MIN(r.event_time_utc) AS first_seen_at,
        MAX(r.event_time_utc) AS last_seen_at,
        SUM(CASE WHEN e.event_name = 'ad_load_success' THEN 1 ELSE 0 END) AS success_events,
        SUM(CASE WHEN e.event_name = 'ad_load_failed' AND e.error_category = 'internal_error' THEN 1 ELSE 0 END) AS internal_error_events,
        MAX(CASE WHEN e.event_name = 'ad_load_success' THEN e.event_time_utc ELSE NULL END) AS success_at,
        MAX(CASE WHEN e.event_name = 'ad_load_failed' AND e.error_category = 'internal_error' THEN e.event_time_utc ELSE NULL END) AS error_at
    FROM `{$source}` r
    LEFT JOIN `{$source}` e ON e.project_code = r.project_code
        AND e.session_id = r.session_id
        AND e.event_time_utc >= '{$since}'
    WHERE r.project_code = '{$project}'
        AND r.event_time_utc >= '{$since}'
        AND r.event_name = 'ad_request'
        AND NULLIF(r.ip_after_connect, '') IS NOT NULL
        AND r.ip_after_connect <> '0.0.0.0'
    GROUP BY r.ip_after_connect, r.session_id
) x
GROUP BY ip_after_connect
HAVING internal_error_sessions > 0
ORDER BY internal_error_sessions DESC
LIMIT 1000
SQL);
    }
}
