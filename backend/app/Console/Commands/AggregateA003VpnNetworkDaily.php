<?php

namespace App\Console\Commands;

use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Console\Command;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use Throwable;

class AggregateA003VpnNetworkDaily extends Command
{
    protected $signature = 'funnel-analysis:aggregate-a003-vpn-network
        {--start-date= : 开始日期 YYYY-MM-DD}
        {--end-date= : 结束日期 YYYY-MM-DD，不传默认今天}
        {--lookback-days=7 : 未指定 start-date 时回刷最近 N 天}';

    protected $description = 'Aggregate A003 VPN diagnostic network dimensions into a MySQL summary table';

    public function handle(): int
    {
        try {
            [$startDate, $endDate] = $this->resolveDateRange();
            $this->createTable();
            $rows = 0;
            foreach (CarbonPeriod::create($startDate, $endDate) as $date) {
                $dateText = $date->toDateString();
                $count = $this->aggregateDate($dateText);
                $rows += $count;
                $this->line(sprintf('[%s] rows=%d', $dateText, $count));
            }
        } catch (Throwable $error) {
            $this->error($error->getMessage());
            return self::FAILURE;
        }

        $this->info(sprintf('A003 VPN network summary rebuilt: %s - %s rows=%d', $startDate, $endDate, $rows));
        return self::SUCCESS;
    }

    /** @return array{0:string,1:string} */
    private function resolveDateRange(): array
    {
        $timezone = (string) config('adb.tracking_events.default_timezone', 'Asia/Shanghai');
        $end = trim((string) ($this->option('end-date') ?: Carbon::now($timezone)->toDateString()));
        $start = trim((string) ($this->option('start-date') ?: ''));
        if ($start === '') {
            $lookback = (int) ($this->option('lookback-days') ?: 7);
            if ($lookback < 1) {
                throw new InvalidArgumentException('--lookback-days 必须大于 0');
            }
            $start = Carbon::parse($end, $timezone)->subDays($lookback - 1)->toDateString();
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $start) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $end)) {
            throw new InvalidArgumentException('日期必须为 YYYY-MM-DD');
        }
        if ($start > $end) {
            throw new InvalidArgumentException('start-date 不能晚于 end-date');
        }
        return [$start, $end];
    }

    private function createTable(): void
    {
        DB::statement(<<<'SQL'
CREATE TABLE IF NOT EXISTS jkcl_a003_vpn_network_daily (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    stat_date DATE NOT NULL,
    project_code VARCHAR(32) NOT NULL,
    app_identifier VARCHAR(191) NOT NULL DEFAULT '',
    platform VARCHAR(32) NOT NULL DEFAULT '',
    app_version VARCHAR(64) NOT NULL DEFAULT '',
    country_code VARCHAR(64) NOT NULL DEFAULT 'unknown',
    user_country_code VARCHAR(64) NOT NULL DEFAULT 'unknown',
    asn VARCHAR(32) NOT NULL DEFAULT 'unknown',
    asn_name VARCHAR(191) NULL,
    server_id VARCHAR(255) NOT NULL DEFAULT 'unknown',
    ip VARCHAR(64) NULL,
    protocol VARCHAR(64) NOT NULL DEFAULT 'unknown',
    event_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    users BIGINT UNSIGNED NOT NULL DEFAULT 0,
    new_users BIGINT UNSIGNED NOT NULL DEFAULT 0,
    dau_users BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_session_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_connect_start_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_connect_success_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_connect_failed_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_config_success_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_config_failed_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_probe_success_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_probe_failed_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_ip_probe_success_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_ip_probe_failed_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_fallback_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_quality_sample_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_quality_poor_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_latency_sum_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
    vpn_latency_sample_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    opportunity_users BIGINT UNSIGNED NOT NULL DEFAULT 0,
    opportunity_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    request_users BIGINT UNSIGNED NOT NULL DEFAULT 0,
    request_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    load_success_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    load_failed_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    show_attempt_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    show_success_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    show_failed_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    show_blocked_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    impression_users BIGINT UNSIGNED NOT NULL DEFAULT 0,
    impression_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    revenue_micros BIGINT NOT NULL DEFAULT 0,
    latest_event_at DATETIME NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_a003_vpn_dims (stat_date, project_code, app_identifier, platform, app_version, country_code, user_country_code, asn, server_id, protocol),
    KEY idx_a003_vpn_query (project_code, stat_date, platform, country_code, app_version),
    KEY idx_a003_vpn_asn (asn),
    KEY idx_a003_vpn_server (server_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);
        $this->ensureMetricColumns();
    }

    private function ensureMetricColumns(): void
    {
        $columns = [
            'vpn_connect_start_count', 'vpn_connect_success_count', 'vpn_connect_failed_count',
            'vpn_config_success_count', 'vpn_config_failed_count', 'vpn_probe_success_count', 'vpn_probe_failed_count',
            'vpn_ip_probe_success_count', 'vpn_ip_probe_failed_count', 'vpn_fallback_count',
            'vpn_quality_sample_count', 'vpn_quality_poor_count', 'vpn_latency_sum_ms', 'vpn_latency_sample_count',
        ];
        if (!Schema::hasColumn('jkcl_a003_vpn_network_daily', 'user_country_code')) {
            DB::statement("ALTER TABLE jkcl_a003_vpn_network_daily ADD COLUMN user_country_code VARCHAR(64) NOT NULL DEFAULT 'unknown' AFTER country_code");
        }
        try {
            DB::statement('ALTER TABLE jkcl_a003_vpn_network_daily DROP INDEX uq_a003_vpn_dims');
        } catch (Throwable $ignored) {
        }
        try {
            DB::statement('ALTER TABLE jkcl_a003_vpn_network_daily ADD UNIQUE KEY uq_a003_vpn_dims (stat_date, project_code, app_identifier, platform, app_version, country_code, user_country_code, asn, server_id, protocol)');
        } catch (Throwable $ignored) {
        }
        foreach ($columns as $column) {
            if (!Schema::hasColumn('jkcl_a003_vpn_network_daily', $column)) {
                DB::statement(sprintf('ALTER TABLE jkcl_a003_vpn_network_daily ADD COLUMN %s BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER vpn_session_count', $column));
            }
        }
    }

    private function aggregateDate(string $date): int
    {
        $domainAsn = $this->domainAsnMap();
        $rows = $this->loadRows($date);
        DB::table('jkcl_a003_vpn_network_daily')->where('project_code', 'A003')->where('stat_date', $date)->delete();

        $aggregated = [];
        $sumFields = [
            'event_count', 'users', 'new_users', 'dau_users', 'vpn_session_count',
            'vpn_connect_start_count', 'vpn_connect_success_count', 'vpn_connect_failed_count',
            'vpn_config_success_count', 'vpn_config_failed_count', 'vpn_probe_success_count', 'vpn_probe_failed_count',
            'vpn_ip_probe_success_count', 'vpn_ip_probe_failed_count', 'vpn_fallback_count',
            'vpn_quality_sample_count', 'vpn_quality_poor_count', 'vpn_latency_sum_ms', 'vpn_latency_sample_count',
            'opportunity_users', 'opportunity_count', 'request_users', 'request_count',
            'load_success_count', 'load_failed_count', 'show_attempt_count', 'show_success_count',
            'show_failed_count', 'show_blocked_count', 'impression_users', 'impression_count',
            'revenue_micros',
        ];

        foreach ($rows as $row) {
            $serverId = $this->cleanDimension($row->server_id ?? null, 'unknown', 255);
            $resolved = $domainAsn[$serverId] ?? null;
            $item = [
                'stat_date' => $date,
                'project_code' => 'A003',
                'app_identifier' => $this->cleanDimension($row->app_identifier ?? null, '', 191),
                'platform' => strtolower($this->cleanDimension($row->platform ?? null, '', 32)),
                'app_version' => $this->cleanDimension($row->app_version ?? null, '', 64),
                'country_code' => $this->vpnExitCountry($resolved->country ?? null, $row->vpn_country_code ?? null),
                'user_country_code' => $this->cleanDimension($row->user_country_code ?? null, 'unknown', 64),
                'asn' => $this->normalizeAsn($resolved->asn ?? $row->asn ?? null),
                'asn_name' => $this->nullableString($resolved->asn_name ?? null, 191),
                'server_id' => $serverId,
                'ip' => $this->nullableString($resolved->ip ?? null, 64),
                'protocol' => $this->cleanDimension($row->protocol ?? null, 'unknown', 64),
                'latest_event_at' => $row->latest_event_at ?: null,
            ];

            foreach ($sumFields as $field) {
                $item[$field] = (int) ($row->{$field} ?? 0);
            }

            $key = implode("\x1f", [
                $item['stat_date'], $item['project_code'], $item['app_identifier'], $item['platform'],
                $item['app_version'], $item['country_code'], $item['user_country_code'], $item['asn'], $item['server_id'], $item['protocol'],
            ]);

            if (!isset($aggregated[$key])) {
                $aggregated[$key] = $item;
                continue;
            }

            foreach ($sumFields as $field) {
                $aggregated[$key][$field] += $item[$field];
            }
            if ($item['latest_event_at'] !== null && (
                $aggregated[$key]['latest_event_at'] === null || $item['latest_event_at'] > $aggregated[$key]['latest_event_at']
            )) {
                $aggregated[$key]['latest_event_at'] = $item['latest_event_at'];
            }
            if ($aggregated[$key]['asn_name'] === null && $item['asn_name'] !== null) {
                $aggregated[$key]['asn_name'] = $item['asn_name'];
            }
            if ($aggregated[$key]['ip'] === null && $item['ip'] !== null) {
                $aggregated[$key]['ip'] = $item['ip'];
            }
        }

        foreach (array_chunk(array_values($aggregated), 500) as $chunk) {
            DB::table('jkcl_a003_vpn_network_daily')->insert($chunk);
        }

        return count($aggregated);
    }

    private function loadRows(string $date)
    {
        $table = (string) config('adb.tracking_events.event_table', 'dwd_app_tracking_event_v18');
        $contextStart = Carbon::parse($date)->subDay()->toDateString();
        $context = DB::connection('adb')->table($table)
            ->where('project_code', 'A003')
            ->whereBetween('event_date', [$contextStart, $date])
            ->where(function (Builder $query): void {
                $query->where('event_name', 'like', 'vpn_%')
                    ->orWhere(function (Builder $session): void {
                        $session->whereNotNull('vpn_session_id')->where('vpn_session_id', '!=', '');
                    });
            })
            ->whereNotNull('my_user_id')->where('my_user_id', '!=', '')
            ->whereNotNull('session_id')->where('session_id', '!=', '')
            ->selectRaw('project_code AS ctx_project_code')
            ->selectRaw('app_identifier AS ctx_app_identifier')
            ->selectRaw('platform AS ctx_platform')
            ->selectRaw('my_user_id AS ctx_user_id')
            ->selectRaw('session_id AS ctx_session_id')
            ->selectRaw("MAX(NULLIF(node_region, '')) AS ctx_node_region")
            ->selectRaw('MAX(asn) AS ctx_asn')
            ->selectRaw("MAX(NULLIF(server_id, '')) AS ctx_server_id")
            ->selectRaw("MAX(NULLIF(protocol, '')) AS ctx_protocol")
            ->groupBy('project_code', 'app_identifier', 'platform', 'my_user_id', 'session_id');

        $userCountry = DB::connection('adb')->table($table)
            ->where('project_code', 'A003')
            ->whereBetween('event_date', [$contextStart, $date])
            ->where('event_name', 'app_once_params')
            ->whereNotNull('my_user_id')->where('my_user_id', '!=', '')
            ->selectRaw('project_code AS uc_project_code')
            ->selectRaw('app_identifier AS uc_app_identifier')
            ->selectRaw('platform AS uc_platform')
            ->selectRaw('my_user_id AS uc_user_id')
            ->selectRaw("MAX(NULLIF(country_code, '')) AS uc_country_code")
            ->groupBy('project_code', 'app_identifier', 'platform', 'my_user_id');

        return DB::connection('adb')->table($table . ' as ad')
            ->leftJoinSub($context, 'vpn_ctx', function ($join): void {
                $join->on('vpn_ctx.ctx_project_code', '=', 'ad.project_code')
                    ->on('vpn_ctx.ctx_app_identifier', '=', 'ad.app_identifier')
                    ->on('vpn_ctx.ctx_platform', '=', 'ad.platform')
                    ->on('vpn_ctx.ctx_user_id', '=', 'ad.my_user_id')
                    ->on('vpn_ctx.ctx_session_id', '=', 'ad.session_id');
            })
            ->leftJoinSub($userCountry, 'user_country', function ($join): void {
                $join->on('user_country.uc_project_code', '=', 'ad.project_code')
                    ->on('user_country.uc_app_identifier', '=', 'ad.app_identifier')
                    ->on('user_country.uc_platform', '=', 'ad.platform')
                    ->on('user_country.uc_user_id', '=', 'ad.my_user_id');
            })
            ->where('ad.project_code', 'A003')
            ->where('ad.event_date', $date)
            ->whereIn('ad.event_name', [
                'app_first_open', 'first_open', 'app_foreground', 'app_active', 'app_once_params',
                'vpn_config_fetch_result', 'vpn_connection_start', 'vpn_connection_result',
                'vpn_server_probe_result', 'vpn_ip_probe_result', 'vpn_protocol_fallback', 'vpn_quality_sample',
                'ad_opportunity', 'ad_request', 'ad_load_success', 'ad_load_failed',
                'ad_show_attempt', 'ad_show_success', 'ad_show_failed', 'ad_show_blocked',
                'ad_impression', 'ad_paid_event',
            ])
            ->selectRaw('ad.event_date AS stat_date')
            ->selectRaw("COALESCE(NULLIF(ad.app_identifier, ''), '') AS app_identifier")
            ->selectRaw("LOWER(COALESCE(NULLIF(ad.platform, ''), '')) AS platform")
            ->selectRaw("COALESCE(NULLIF(ad.app_version, ''), '') AS app_version")
            ->selectRaw("COALESCE(NULLIF(ad.node_region, ''), NULLIF(vpn_ctx.ctx_node_region, ''), 'unknown') AS vpn_country_code")
            ->selectRaw("COALESCE(NULLIF(user_country.uc_country_code, ''), 'unknown') AS user_country_code")
            ->selectRaw("COALESCE(CAST(ad.asn AS CHAR), CAST(vpn_ctx.ctx_asn AS CHAR), 'unknown') AS asn")
            ->selectRaw("COALESCE(NULLIF(ad.server_id, ''), NULLIF(vpn_ctx.ctx_server_id, ''), 'unknown') AS server_id")
            ->selectRaw("COALESCE(NULLIF(ad.protocol, ''), NULLIF(vpn_ctx.ctx_protocol, ''), 'unknown') AS protocol")
            ->selectRaw('COUNT(*) AS event_count')
            ->selectRaw("COUNT(DISTINCT NULLIF(ad.my_user_id, '')) AS users")
            ->selectRaw("COUNT(DISTINCT CASE WHEN ad.event_name = 'app_first_open' THEN NULLIF(ad.my_user_id, '') END) AS new_users")
            ->selectRaw("COUNT(DISTINCT CASE WHEN ad.event_name IN ('app_foreground', 'app_active') THEN NULLIF(ad.my_user_id, '') END) AS dau_users")
            ->selectRaw("COUNT(DISTINCT CASE WHEN COALESCE(ad.vpn_session_id, '') <> '' THEN ad.vpn_session_id ELSE NULLIF(ad.session_id, '') END) AS vpn_session_count")
            ->selectRaw("COUNT(DISTINCT CASE WHEN ad.event_name = 'vpn_connection_start' THEN NULLIF(COALESCE(ad.vpn_session_id, ad.session_id), '') END) AS vpn_connect_start_count")
            ->selectRaw("COUNT(DISTINCT CASE WHEN ad.event_name = 'vpn_connection_result' AND COALESCE(NULLIF(ad.vpn_status, ''), NULLIF(ad.result_status, '')) = 'success' THEN NULLIF(COALESCE(ad.vpn_session_id, ad.session_id), '') END) AS vpn_connect_success_count")
            ->selectRaw("COUNT(DISTINCT CASE WHEN ad.event_name = 'vpn_connection_result' AND COALESCE(NULLIF(ad.vpn_status, ''), NULLIF(ad.result_status, '')) <> 'success' THEN NULLIF(COALESCE(ad.vpn_session_id, ad.session_id), '') END) AS vpn_connect_failed_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'vpn_config_fetch_result' AND ad.result_status = 'success' THEN 1 ELSE 0 END) AS vpn_config_success_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'vpn_config_fetch_result' AND COALESCE(ad.result_status, '') <> 'success' THEN 1 ELSE 0 END) AS vpn_config_failed_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'vpn_server_probe_result' AND ad.probe_result = 'success' THEN 1 ELSE 0 END) AS vpn_probe_success_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'vpn_server_probe_result' AND COALESCE(ad.probe_result, '') <> 'success' THEN 1 ELSE 0 END) AS vpn_probe_failed_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'vpn_ip_probe_result' AND ad.probe_result = 'success' THEN 1 ELSE 0 END) AS vpn_ip_probe_success_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'vpn_ip_probe_result' AND COALESCE(ad.probe_result, '') <> 'success' THEN 1 ELSE 0 END) AS vpn_ip_probe_failed_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'vpn_protocol_fallback' THEN 1 ELSE 0 END) AS vpn_fallback_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'vpn_quality_sample' THEN 1 ELSE 0 END) AS vpn_quality_sample_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'vpn_quality_sample' AND ad.vpn_quality_status IN ('poor', 'bad') THEN 1 ELSE 0 END) AS vpn_quality_poor_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'vpn_quality_sample' AND ad.latency_ms IS NOT NULL THEN ad.latency_ms ELSE 0 END) AS vpn_latency_sum_ms")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'vpn_quality_sample' AND ad.latency_ms IS NOT NULL THEN 1 ELSE 0 END) AS vpn_latency_sample_count")
            ->selectRaw("COUNT(DISTINCT CASE WHEN ad.event_name = 'ad_opportunity' THEN NULLIF(ad.my_user_id, '') END) AS opportunity_users")
            ->selectRaw("COUNT(DISTINCT CASE WHEN ad.event_name = 'ad_opportunity' THEN NULLIF(ad.opportunity_id, '') END) AS opportunity_count")
            ->selectRaw("COUNT(DISTINCT CASE WHEN ad.event_name = 'ad_request' THEN NULLIF(ad.my_user_id, '') END) AS request_users")
            ->selectRaw("COUNT(DISTINCT CASE WHEN ad.event_name = 'ad_request' THEN NULLIF(ad.request_id, '') END) AS request_count")
            ->selectRaw("COUNT(DISTINCT CASE WHEN ad.event_name = 'ad_load_success' THEN NULLIF(ad.request_id, '') END) AS load_success_count")
            ->selectRaw("COUNT(DISTINCT CASE WHEN ad.event_name = 'ad_load_failed' THEN NULLIF(ad.request_id, '') END) AS load_failed_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'ad_show_attempt' THEN 1 ELSE 0 END) AS show_attempt_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'ad_show_success' THEN 1 ELSE 0 END) AS show_success_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'ad_show_failed' THEN 1 ELSE 0 END) AS show_failed_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'ad_show_blocked' THEN 1 ELSE 0 END) AS show_blocked_count")
            ->selectRaw("COUNT(DISTINCT CASE WHEN ad.event_name = 'ad_impression' THEN NULLIF(ad.my_user_id, '') END) AS impression_users")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'ad_impression' THEN 1 ELSE 0 END) AS impression_count")
            ->selectRaw("SUM(CASE WHEN ad.event_name = 'ad_paid_event' THEN COALESCE(ad.value_micros, 0) ELSE 0 END) AS revenue_micros")
            ->selectRaw('MAX(ad.event_time_utc) AS latest_event_at')
            ->groupBy('ad.event_date', 'app_identifier', 'platform', 'app_version', 'vpn_country_code', 'user_country_code', 'asn', 'server_id', 'protocol')
            ->get();
    }

    private function domainAsnMap(): array
    {
        return DB::table('jkcl_vpn_domain_asn')
            ->where('project_code', 'A003')
            ->get()
            ->keyBy('domain')
            ->all();
    }


    private function vpnExitCountry(mixed $resolvedCountry, mixed $nodeRegion): string
    {
        $country = trim((string) ($resolvedCountry ?? ''));
        if ($country === '') {
            $country = trim((string) ($nodeRegion ?? ''));
            if (preg_match('/^([A-Z]{2})[-_].+$/i', $country, $matches) === 1) {
                $country = strtoupper($matches[1]);
            }
        }
        return $this->cleanDimension($country, 'unknown', 64);
    }

    private function cleanDimension(mixed $value, string $fallback, int $maxLength): string
    {
        $value = trim((string) ($value ?? ''));
        if ($value === '') {
            $value = $fallback;
        }
        return function_exists('mb_substr') ? mb_substr($value, 0, $maxLength) : substr($value, 0, $maxLength);
    }

    private function nullableString(mixed $value, int $maxLength): ?string
    {
        $value = trim((string) ($value ?? ''));
        if ($value === '') {
            return null;
        }
        return function_exists('mb_substr') ? mb_substr($value, 0, $maxLength) : substr($value, 0, $maxLength);
    }

    private function normalizeAsn(mixed $value): string
    {
        $value = strtoupper(trim((string) ($value ?? '')));
        if ($value === '' || $value === '0') {
            return 'unknown';
        }
        if (preg_match('/^\d+$/', $value) === 1) {
            return 'AS' . $value;
        }
        if (preg_match('/^(AS\d+)/', $value, $matches) === 1) {
            return $matches[1];
        }
        return $value;
    }
}

