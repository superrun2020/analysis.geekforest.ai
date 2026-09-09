<?php

namespace App\Services;

use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class FunnelAnalyticsAggregateService
{
    private function connection(): string
    {
        return (string) config('adb.funnel_aggregates.write_connection', 'adb_write');
    }

    private const FUNNELS = [
        [
            'code' => 'ad_user_coverage',
            'scope' => 'users',
            'subject' => 'my_user_id',
            'steps' => [
                ['code' => 'dau', 'event' => 'app_foreground'],
                ['code' => 'eligibility', 'event' => 'ad_eligibility_check'],
                ['code' => 'eligible', 'event' => 'ad_eligibility_check', 'condition' => 'e.eligible = 1'],
                ['code' => 'opportunity', 'event' => 'ad_opportunity'],
                ['code' => 'request', 'event' => 'ad_request'],
                ['code' => 'show_attempt', 'event' => 'ad_show_attempt'],
                ['code' => 'impression', 'event' => 'ad_impression'],
                ['code' => 'paid', 'event' => 'ad_paid_event'],
            ],
        ],
        [
            'code' => 'ad_session_coverage',
            'scope' => 'sessions',
            'subject' => 'session_id',
            'steps' => [
                ['code' => 'dau', 'event' => 'app_foreground'],
                ['code' => 'eligibility', 'event' => 'ad_eligibility_check'],
                ['code' => 'eligible', 'event' => 'ad_eligibility_check', 'condition' => 'e.eligible = 1'],
                ['code' => 'opportunity', 'event' => 'ad_opportunity'],
                ['code' => 'request', 'event' => 'ad_request'],
                ['code' => 'show_attempt', 'event' => 'ad_show_attempt'],
                ['code' => 'impression', 'event' => 'ad_impression'],
                ['code' => 'paid', 'event' => 'ad_paid_event'],
            ],
        ],
        [
            'code' => 'vpn_user_coverage',
            'scope' => 'users',
            'subject' => 'my_user_id',
            'steps' => [
                ['code' => 'dau', 'event' => 'app_foreground'],
                ['code' => 'connect_attempt', 'event' => 'vpn_connection_start'],
                ['code' => 'connect_success', 'event' => 'vpn_connection_result', 'condition' => "LOWER(COALESCE(e.result_status, '')) = 'success'"],
                ['code' => 'post_connect_opportunity', 'event' => 'ad_opportunity', 'condition' => 'e.vpn_active = 1'],
                ['code' => 'post_connect_impression', 'event' => 'ad_impression', 'condition' => 'e.vpn_active = 1'],
            ],
        ],
        [
            'code' => 'vpn_session_coverage',
            'scope' => 'sessions',
            'subject' => 'vpn_session_id',
            'steps' => [
                ['code' => 'connect_attempt', 'event' => 'vpn_connection_start'],
                ['code' => 'connect_success', 'event' => 'vpn_connection_result', 'condition' => "LOWER(COALESCE(e.result_status, '')) = 'success'"],
                ['code' => 'post_connect_opportunity', 'event' => 'ad_opportunity', 'condition' => 'e.vpn_active = 1'],
                ['code' => 'post_connect_impression', 'event' => 'ad_impression', 'condition' => 'e.vpn_active = 1'],
            ],
        ],
    ];

    /**
     * 按业务日期幂等重建七张漏斗分析聚合表。
     *
     * @return array{startDate:string,endDate:string,projectCode:?string,dates:int,tableRows:array<string,int>}
     */
    public function aggregate(string $startDate, string $endDate, ?string $projectCode = null): array
    {
        $start = Carbon::createFromFormat('Y-m-d', $startDate)->startOfDay();
        $end = Carbon::createFromFormat('Y-m-d', $endDate)->startOfDay();
        if ($start->gt($end)) {
            throw new RuntimeException('startDate must be less than or equal to endDate.');
        }

        $this->assertReady();
        $stats = [
            'startDate' => $start->toDateString(),
            'endDate' => $end->toDateString(),
            'projectCode' => $projectCode,
            'dates' => 0,
            'tableRows' => array_fill_keys(array_values($this->tables()), 0),
        ];

        foreach (CarbonPeriod::create($start, $end) as $date) {
            $dateString = $date->toDateString();
            $lock = Cache::lock(
                'funnel-aggregate:' . $dateString,
                max(60, (int) config('adb.funnel_aggregates.lock_seconds', 1800))
            );
            if (!$lock->get()) {
                continue;
            }

            try {
                $dateRows = $this->aggregateDate($dateString, $projectCode);
                $stats['dates']++;
                foreach ($dateRows as $table => $rows) {
                    $stats['tableRows'][$table] += $rows;
                }
            } finally {
                $lock->release();
            }
        }

        return $stats;
    }

    /** @return array<string, int> */
    private function aggregateDate(string $date, ?string $projectCode): array
    {
        $rows = [];
        $rows[$this->table('subject_stage_daily')] = $this->rebuildSubjectStages($date, $projectCode);
        $rows[$this->table('funnel_stage_hourly')] = $this->rebuildFunnelStages($date, $projectCode, true);
        $rows[$this->table('funnel_stage_daily')] = $this->rebuildFunnelStages($date, $projectCode, false);
        $rows[$this->table('ad_fulfillment_daily')] = $this->rebuildAdFulfillment($date, $projectCode);
        $rows[$this->table('vpn_quality_daily')] = $this->rebuildVpnQuality($date, $projectCode);
        $rows[$this->table('event_quality_daily')] = $this->rebuildEventQuality($date, $projectCode);
        $rows[$this->table('screen_path_daily')] = $this->rebuildScreenPaths($date, $projectCode);

        return $rows;
    }

    /**
     * 生成广告与 VPN 两条用户漏斗的主体步骤轻量明细。
     */
    private function rebuildSubjectStages(string $date, ?string $projectCode): int
    {
        $table = $this->table('subject_stage_daily');
        $this->clearDate($table, 'stat_date', $date, $projectCode);
        $rows = 0;

        foreach (self::FUNNELS as $funnel) {
            foreach ($funnel['steps'] as $index => $step) {
                $rows += $this->insertSubjectStep(
                    $table,
                    $date,
                    $projectCode,
                    $funnel['code'],
                    $funnel['scope'],
                    $funnel['subject'],
                    $step['code'],
                    $index + 1,
                    $step['event'],
                    $step['condition'] ?? null
                );
            }
        }

        return $rows;
    }

    private function insertSubjectStep(
        string $targetTable,
        string $date,
        ?string $projectCode,
        string $funnelCode,
        string $scope,
        string $subjectColumn,
        string $stepCode,
        int $stepOrder,
        string $eventName,
        ?string $condition
    ): int {
        if (!in_array($subjectColumn, ['my_user_id', 'session_id', 'vpn_session_id'], true)) {
            throw new RuntimeException("Unsupported funnel subject column: {$subjectColumn}");
        }
        $subjectType = $subjectColumn === 'my_user_id' ? 'user' : ($subjectColumn === 'vpn_session_id' ? 'vpn_session' : 'session');
        $subjectExpression = "e.{$subjectColumn}";
        [$sourceJoin, $sourceWhere, $bindings] = $this->sourceScope($date, $projectCode, 'e');
        $conditionSql = $condition ? "\n  AND {$condition}" : '';
        $versionId = $this->literal((string) config('adb.funnel_aggregates.funnel_version_id', 'builtin-jkcl-v1.8'));
        $funnel = $this->literal($funnelCode);
        $scopeLiteral = $this->literal($scope);
        $step = $this->literal($stepCode);
        $source = $this->quote($this->sourceTable());
        $target = $this->quote($targetTable);

        $sql = <<<SQL
INSERT INTO {$target} (
    subject_stage_id, stat_date, project_id, project_code, app_identifier, platform,
    app_version, build_number, country_code, network_type, funnel_version_id, funnel_code,
    scope_type, step_code, step_order, subject_type, subject_id_hash, chain_root_type,
    chain_root_hash, first_reached_at, last_reached_at, event_count, source_mask,
    api_seen, firebase_seen, data_status, computed_at
)
SELECT
    SHA2(CONCAT_WS('|', e.event_date, COALESCE(e.project_code, ''), COALESCE(e.app_identifier, ''),
        {$funnel}, {$scopeLiteral}, {$step}, SHA2({$subjectExpression}, 256), COALESCE(e.app_version, ''),
        COALESCE(CAST(e.app_build AS CHAR), ''), COALESCE(e.country_code, ''), COALESCE(e.network_type, '')), 256),
    e.event_date,
    MAX(e.project_id),
    COALESCE(e.project_code, ''),
    COALESCE(e.app_identifier, ''),
    NULLIF(e.platform, ''),
    NULLIF(e.app_version, ''),
    NULLIF(CAST(e.app_build AS CHAR), ''),
    NULLIF(e.country_code, ''),
    NULLIF(e.network_type, ''),
    {$versionId}, {$funnel}, {$scopeLiteral}, {$step}, {$stepOrder}, '{$subjectType}',
    SHA2({$subjectExpression}, 256), '{$subjectType}', SHA2({$subjectExpression}, 256),
    MIN(e.event_time_utc), MAX(e.event_time_utc), COUNT(*),
    CAST(MAX(e.api_seen) + (2 * MAX(e.firebase_seen)) AS INTEGER),
    MAX(e.api_seen), MAX(e.firebase_seen),
    CASE
        WHEN MAX(CASE WHEN e.data_status = 'final' THEN 1 ELSE 0 END) = 1 THEN 'final'
        WHEN MAX(e.firebase_seen) = 1 THEN 'verified'
        ELSE 'realtime'
    END,
    UTC_TIMESTAMP()
FROM {$source} e
{$sourceJoin}
WHERE {$sourceWhere}
  AND e.event_name = ?
  AND {$subjectExpression} IS NOT NULL
  AND {$subjectExpression} <> ''
{$conditionSql}
GROUP BY e.event_date, COALESCE(e.project_code, ''), COALESCE(e.app_identifier, ''),
    NULLIF(e.platform, ''), NULLIF(e.app_version, ''), NULLIF(CAST(e.app_build AS CHAR), ''),
    NULLIF(e.country_code, ''), NULLIF(e.network_type, ''), SHA2({$subjectExpression}, 256)
SQL;
        $bindings[] = $eventName;

        return DB::connection($this->connection())->affectingStatement($sql, $bindings);
    }

    /**
     * 从主体步骤表生成小时或日漏斗，UV 不通过小时结果相加。
     */
    private function rebuildFunnelStages(string $date, ?string $projectCode, bool $hourly): int
    {
        $targetTable = $this->table($hourly ? 'funnel_stage_hourly' : 'funnel_stage_daily');
        $this->clearDate($targetTable, 'stat_date', $date, $projectCode);
        $aggregates = $this->stageAggregates($date, $projectCode, $hourly);
        $linked = $this->linkedStageCounts($date, $projectCode, $hourly);
        $counts = [];
        foreach ($aggregates as $row) {
            $counts[$this->stageKey($row, false)] = (int) $row['subject_count'];
        }

        $insertRows = [];
        foreach ($aggregates as $row) {
            $stepOrder = (int) $row['step_order'];
            $previousCount = $stepOrder === 1
                ? 0
                : ($counts[$this->stageKey($row, false, $stepOrder - 1)] ?? 0);
            $headCount = $counts[$this->stageKey($row, false, 1)] ?? 0;
            $linkedCount = $stepOrder === 1
                ? (int) $row['subject_count']
                : ($linked[$this->stageKey($row, true)] ?? 0);
            $subjectCount = (int) $row['subject_count'];
            $dimensions = $this->stageDimensions($row, $hourly);
            $insertRows[] = $dimensions + [
                'summary_id' => hash('sha256', implode('|', array_map(
                    static fn ($value): string => (string) ($value ?? ''),
                    array_values($dimensions)
                ))),
                'device_model' => null,
                'ad_format' => null,
                'placement' => null,
                'ad_source' => null,
                'protocol' => null,
                'server_id' => null,
                'lifecycle_group' => null,
                'vpn_state' => null,
                'previous_step_code' => $stepOrder > 1 ? $this->previousStepCode((string) $row['funnel_code'], $stepOrder) : null,
                'event_count' => (int) $row['event_count'],
                'subject_count' => $subjectCount,
                'linked_subject_count' => $linkedCount,
                'previous_subject_count' => $previousCount,
                'conversion_rate' => $previousCount > 0 ? round($linkedCount / $previousCount, 8) : null,
                'head_conversion_rate' => $headCount > 0 ? round($subjectCount / $headCount, 8) : null,
                'lost_subject_count' => max(0, $previousCount - $linkedCount),
                'estimated_lost_impressions' => null,
                'estimated_revenue_micros' => null,
                'api_event_count' => (int) $row['api_event_count'],
                'firebase_event_count' => (int) $row['firebase_event_count'],
                'both_source_event_count' => (int) $row['both_source_event_count'],
                'data_status' => $this->statusFromFlags($row),
                'metric_version' => (string) config('adb.funnel_aggregates.metric_version'),
                'computed_at' => now('UTC')->format('Y-m-d H:i:s'),
            ];
        }

        return $this->insertRows($targetTable, $insertRows);
    }

    /** @return array<int, array<string, mixed>> */
    private function stageAggregates(string $date, ?string $projectCode, bool $hourly): array
    {
        $table = $this->quote($this->table('subject_stage_daily'));
        [$projectSql, $bindings] = $this->simpleProjectFilter('d', $projectCode, [$date]);
        $hourSelect = '';
        $hourJoin = '';
        $hourGroup = '';
        if ($hourly) {
            $offset = max(-12, min(14, (int) config('adb.funnel_aggregates.timezone_offset_hours', 8)));
            [$headProjectSql, $headBindings] = $this->simpleProjectFilter('h0', $projectCode, [$date]);
            $bindings = array_merge($headBindings, $bindings);
            $hourSelect = ", DATE_FORMAT(DATE_ADD(h.head_at, INTERVAL {$offset} HOUR), '%Y-%m-%d %H:00:00') AS stat_hour";
            $hourGroup = ", DATE_FORMAT(DATE_ADD(h.head_at, INTERVAL {$offset} HOUR), '%Y-%m-%d %H:00:00')";
            $hourJoin = <<<SQL
JOIN (
    SELECT h0.stat_date, h0.project_code, h0.app_identifier, h0.funnel_code, h0.scope_type,
        h0.subject_id_hash, MIN(h0.first_reached_at) AS head_at
    FROM {$table} h0
    WHERE h0.stat_date = ? {$headProjectSql} AND h0.step_order = 1
    GROUP BY h0.stat_date, h0.project_code, h0.app_identifier, h0.funnel_code,
        h0.scope_type, h0.subject_id_hash
) h ON h.stat_date = d.stat_date AND h.project_code = d.project_code
    AND h.app_identifier = d.app_identifier AND h.funnel_code = d.funnel_code
    AND h.scope_type = d.scope_type AND h.subject_id_hash = d.subject_id_hash
SQL;
        }

        $sql = <<<SQL
SELECT d.stat_date, MAX(d.project_id) AS project_id, d.project_code, d.app_identifier,
    d.platform, d.app_version, d.build_number, d.country_code, d.network_type,
    d.funnel_version_id, d.funnel_code, d.scope_type, d.step_code, d.step_order
    {$hourSelect},
    SUM(d.event_count) AS event_count,
    COUNT(DISTINCT d.subject_id_hash) AS subject_count,
    SUM(CASE WHEN d.api_seen = 1 THEN d.event_count ELSE 0 END) AS api_event_count,
    SUM(CASE WHEN d.firebase_seen = 1 THEN d.event_count ELSE 0 END) AS firebase_event_count,
    SUM(CASE WHEN d.api_seen = 1 AND d.firebase_seen = 1 THEN d.event_count ELSE 0 END) AS both_source_event_count,
    MAX(CASE WHEN d.data_status = 'final' THEN 1 ELSE 0 END) AS has_final,
    MAX(d.firebase_seen) AS has_firebase
FROM {$table} d
{$hourJoin}
WHERE d.stat_date = ? {$projectSql}
GROUP BY d.stat_date, d.project_code, d.app_identifier, d.platform, d.app_version,
    d.build_number, d.country_code, d.network_type, d.funnel_version_id, d.funnel_code,
    d.scope_type, d.step_code, d.step_order {$hourGroup}
ORDER BY d.funnel_code, d.step_order
SQL;

        return array_map(static fn ($row): array => (array) $row, DB::connection($this->connection())->select($sql, $bindings));
    }

    /** @return array<string, int> */
    private function linkedStageCounts(string $date, ?string $projectCode, bool $hourly): array
    {
        $table = $this->quote($this->table('subject_stage_daily'));
        [$projectSql, $bindings] = $this->simpleProjectFilter('d', $projectCode, [$date]);
        $hourSelect = '';
        $hourJoin = '';
        $hourGroup = '';
        if ($hourly) {
            $offset = max(-12, min(14, (int) config('adb.funnel_aggregates.timezone_offset_hours', 8)));
            [$headProjectSql, $headBindings] = $this->simpleProjectFilter('h0', $projectCode, [$date]);
            $bindings = array_merge($headBindings, $bindings);
            $hourSelect = ", DATE_FORMAT(DATE_ADD(h.head_at, INTERVAL {$offset} HOUR), '%Y-%m-%d %H:00:00') AS stat_hour";
            $hourGroup = ", DATE_FORMAT(DATE_ADD(h.head_at, INTERVAL {$offset} HOUR), '%Y-%m-%d %H:00:00')";
            $hourJoin = <<<SQL
JOIN (
    SELECT h0.stat_date, h0.project_code, h0.app_identifier, h0.funnel_code, h0.scope_type,
        h0.subject_id_hash, MIN(h0.first_reached_at) AS head_at
    FROM {$table} h0
    WHERE h0.stat_date = ? {$headProjectSql} AND h0.step_order = 1
    GROUP BY h0.stat_date, h0.project_code, h0.app_identifier, h0.funnel_code,
        h0.scope_type, h0.subject_id_hash
) h ON h.stat_date = d.stat_date AND h.project_code = d.project_code
    AND h.app_identifier = d.app_identifier AND h.funnel_code = d.funnel_code
    AND h.scope_type = d.scope_type AND h.subject_id_hash = d.subject_id_hash
SQL;
        }

        $sql = <<<SQL
SELECT d.stat_date, d.project_code, d.app_identifier, d.platform, d.app_version,
    d.build_number, d.country_code, d.network_type, d.funnel_version_id, d.funnel_code,
    d.scope_type, d.step_code, d.step_order {$hourSelect},
    COUNT(DISTINCT d.subject_id_hash) AS linked_count
FROM {$table} d
JOIN {$table} p ON p.stat_date = d.stat_date AND p.project_code = d.project_code
    AND p.app_identifier = d.app_identifier AND p.funnel_code = d.funnel_code
    AND p.scope_type = d.scope_type AND p.step_order = d.step_order - 1
    AND p.subject_id_hash = d.subject_id_hash
    AND p.platform <=> d.platform AND p.app_version <=> d.app_version
    AND p.build_number <=> d.build_number AND p.country_code <=> d.country_code
    AND p.network_type <=> d.network_type
{$hourJoin}
WHERE d.stat_date = ? {$projectSql} AND d.step_order > 1
GROUP BY d.stat_date, d.project_code, d.app_identifier, d.platform, d.app_version,
    d.build_number, d.country_code, d.network_type, d.funnel_version_id, d.funnel_code,
    d.scope_type, d.step_code, d.step_order {$hourGroup}
SQL;

        $result = [];
        foreach (DB::connection($this->connection())->select($sql, $bindings) as $row) {
            $array = (array) $row;
            $result[$this->stageKey($array, true)] = (int) $array['linked_count'];
        }

        return $result;
    }

    /**
     * 汇总广告资格、机会、缓存、请求、展示和收入真实事件。
     */
    private function rebuildAdFulfillment(string $date, ?string $projectCode): int
    {
        $targetTable = $this->table('ad_fulfillment_daily');
        $this->clearDate($targetTable, 'stat_date', $date, $projectCode);
        [$sourceJoin, $sourceWhere, $bindings] = $this->sourceScope($date, $projectCode, 'e');
        $source = $this->quote($this->sourceTable());
        $target = $this->quote($targetTable);
        $decisionId = $this->jsonText('e.event_params_json', 'decision_id');
        $requestType = $this->jsonText('e.event_params_json', 'request_type');
        $duration = 'COALESCE(e.request_duration_ms, e.load_duration_ms)';
        $status = $this->dataStatusSql('e');
        $metricVersion = $this->literal((string) config('adb.funnel_aggregates.metric_version'));

        $sql = <<<SQL
INSERT INTO {$target} (
    summary_id, stat_date, project_id, project_code, app_identifier, platform, app_version,
    build_number, country_code, network_type, device_model, ad_format, placement, ad_source,
    request_type, refill_reason, policy_version, dau_users, eligibility_users,
    eligibility_decision_count, eligible_decision_count, ineligible_decision_count,
    opportunity_users, opportunity_count, cache_decision_count, cache_hit_count,
    cache_miss_count, cache_take_count, cache_put_count, cache_expired_count,
    cache_discard_count, request_users, request_count, preload_request_count,
    cache_refill_request_count, on_demand_request_count, retry_request_count,
    terminal_request_count, load_success_count, load_failed_count, ready_instance_count,
    load_success_unshown_24h_count, show_attempt_count, show_success_count,
    show_failed_count, show_blocked_count, impression_users, impression_count,
    click_users, click_count, paid_users, paid_event_count, revenue_micros,
    unfulfilled_opportunity_count, orphan_decision_count, orphan_opportunity_count,
    orphan_request_count, orphan_instance_count, request_duration_sample_count,
    request_duration_avg_ms, request_duration_p95_ms, api_event_count,
    firebase_event_count, both_source_event_count, data_status, metric_version, computed_at
)
SELECT
    SHA2(CONCAT_WS('|', e.event_date, COALESCE(e.project_code, ''), COALESCE(e.app_identifier, ''),
        COALESCE(e.platform, ''), COALESCE(e.app_version, ''), COALESCE(CAST(e.app_build AS CHAR), ''),
        COALESCE(e.country_code, ''), COALESCE(e.network_type, ''), COALESCE(e.device_model, '')), 256),
    e.event_date, MAX(e.project_id), COALESCE(e.project_code, ''), COALESCE(e.app_identifier, ''),
    NULLIF(e.platform, ''), NULLIF(e.app_version, ''), NULLIF(CAST(e.app_build AS CHAR), ''),
    NULLIF(e.country_code, ''), NULLIF(e.network_type, ''), NULLIF(e.device_model, ''),
    NULL, NULL, NULL, NULL, NULL, NULL,
    COUNT(DISTINCT CASE WHEN e.event_name = 'app_foreground' THEN NULLIF(e.my_user_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_eligibility_check' THEN NULLIF(e.my_user_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_eligibility_check' THEN NULLIF({$decisionId}, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_eligibility_check' AND e.eligible = 1 THEN NULLIF({$decisionId}, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_eligibility_check' AND e.eligible = 0 THEN NULLIF({$decisionId}, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_opportunity' THEN NULLIF(e.my_user_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_opportunity' THEN NULLIF(e.opportunity_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name IN ('ad_cache_hit','ad_cache_miss') THEN NULLIF(e.opportunity_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_cache_hit' THEN NULLIF(e.opportunity_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_cache_miss' THEN NULLIF(e.opportunity_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_cache_take' THEN NULLIF(e.ad_instance_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_cache_put' THEN NULLIF(e.ad_instance_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_cache_expired' THEN NULLIF(e.ad_instance_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_cache_discard' THEN NULLIF(e.ad_instance_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_request' THEN NULLIF(e.my_user_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_request' THEN NULLIF(e.request_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_request' AND (e.is_preload = 1 OR {$requestType} = 'splash_preload') THEN NULLIF(e.request_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_request' AND {$requestType} = 'cache_refill' THEN NULLIF(e.request_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_request' AND (e.is_preload = 0 OR {$requestType} = 'on_demand') THEN NULLIF(e.request_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_request' AND COALESCE(e.retry_index, 0) > 0 THEN NULLIF(e.request_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name IN ('ad_load_success','ad_load_failed') THEN NULLIF(e.request_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_load_success' THEN NULLIF(e.request_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_load_failed' THEN NULLIF(e.request_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_cache_put' THEN NULLIF(e.ad_instance_id, '') END),
    0,
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_show_attempt' THEN COALESCE(NULLIF(e.ad_instance_id, ''), NULLIF(e.event_id, '')) END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_show_success' THEN COALESCE(NULLIF(e.ad_instance_id, ''), NULLIF(e.event_id, '')) END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_show_failed' THEN COALESCE(NULLIF(e.ad_instance_id, ''), NULLIF(e.event_id, '')) END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_show_blocked' THEN COALESCE(NULLIF(e.ad_instance_id, ''), NULLIF(e.event_id, '')) END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_impression' THEN NULLIF(e.my_user_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_impression' THEN e.event_id END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_click' THEN NULLIF(e.my_user_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_click' THEN e.event_id END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_paid_event' THEN NULLIF(e.my_user_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_paid_event' THEN e.event_id END),
    SUM(CASE WHEN e.event_name = 'ad_paid_event' THEN COALESCE(e.value_micros, 0) ELSE 0 END),
    GREATEST(0,
        COUNT(DISTINCT CASE WHEN e.event_name = 'ad_opportunity' THEN NULLIF(e.opportunity_id, '') END)
        - COUNT(DISTINCT CASE WHEN e.event_name = 'ad_impression' THEN NULLIF(e.opportunity_id, '') END)),
    SUM(CASE WHEN e.event_name = 'ad_eligibility_check' AND NULLIF({$decisionId}, '') IS NULL THEN 1 ELSE 0 END),
    SUM(CASE WHEN e.event_name IN ('ad_cache_hit','ad_cache_miss','ad_request','ad_show_attempt','ad_impression')
        AND NULLIF(e.opportunity_id, '') IS NULL THEN 1 ELSE 0 END),
    SUM(CASE WHEN e.event_name IN ('ad_load_success','ad_load_failed','ad_cache_put','ad_show_attempt','ad_impression')
        AND NULLIF(e.request_id, '') IS NULL THEN 1 ELSE 0 END),
    SUM(CASE WHEN e.event_name IN ('ad_cache_put','ad_cache_take','ad_show_attempt','ad_impression','ad_paid_event')
        AND NULLIF(e.ad_instance_id, '') IS NULL THEN 1 ELSE 0 END),
    SUM(CASE WHEN e.event_name IN ('ad_request','ad_load_success','ad_load_failed') AND {$duration} IS NOT NULL THEN 1 ELSE 0 END),
    CAST(AVG(CASE WHEN e.event_name IN ('ad_request','ad_load_success','ad_load_failed') THEN {$duration} END) AS DECIMAL(20,4)),
    CAST(APPROX_PERCENTILE(CASE WHEN e.event_name IN ('ad_request','ad_load_success','ad_load_failed') THEN {$duration} END, 0.95) AS BIGINT),
    SUM(CASE WHEN e.api_seen = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN e.firebase_seen = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN e.api_seen = 1 AND e.firebase_seen = 1 THEN 1 ELSE 0 END),
    {$status}, {$metricVersion}, UTC_TIMESTAMP()
FROM {$source} e
{$sourceJoin}
WHERE {$sourceWhere}
GROUP BY e.event_date, COALESCE(e.project_code, ''), COALESCE(e.app_identifier, ''),
    NULLIF(e.platform, ''), NULLIF(e.app_version, ''), NULLIF(CAST(e.app_build AS CHAR), ''),
    NULLIF(e.country_code, ''), NULLIF(e.network_type, ''), NULLIF(e.device_model, '')
SQL;

        return DB::connection($this->connection())->affectingStatement($sql, $bindings);
    }

    /**
     * 生成 VPN 整体和连接阶段两种日聚合行。
     */
    private function rebuildVpnQuality(string $date, ?string $projectCode): int
    {
        $targetTable = $this->table('vpn_quality_daily');
        $this->clearDate($targetTable, 'stat_date', $date, $projectCode);

        return $this->insertVpnAggregate($targetTable, $date, $projectCode, 'overall')
            + $this->insertVpnAggregate($targetTable, $date, $projectCode, 'protocol')
            + $this->insertVpnAggregate($targetTable, $date, $projectCode, 'phase');
    }

    private function insertVpnAggregate(string $targetTable, string $date, ?string $projectCode, string $mode): int
    {
        if (!in_array($mode, ['overall', 'protocol', 'phase'], true)) {
            throw new RuntimeException("Invalid VPN aggregate mode: {$mode}");
        }

        [$sourceJoin, $sourceWhere, $bindings] = $this->sourceScope($date, $projectCode, 'e');
        $source = $this->quote($this->sourceTable());
        $target = $this->quote($targetTable);
        $phaseCondition = match ($mode) {
            'phase' => " AND e.event_name = 'vpn_connection_phase' AND NULLIF(e.phase_name, '') IS NOT NULL",
            'protocol' => " AND e.event_name LIKE 'vpn_%' AND (NULLIF(e.protocol, '') IS NOT NULL OR NULLIF(e.server_id, '') IS NOT NULL)",
            default => " AND e.event_name IN (
            'app_foreground','vpn_permission_result','vpn_node_selected','vpn_connection_start',
            'vpn_connection_phase','vpn_protocol_fallback','vpn_connection_result',
            'vpn_ip_probe_result','vpn_connectivity_check','vpn_disconnection',
            'ad_opportunity','ad_impression')",
        };
        $detail = $mode !== 'overall';
        $protocolSelect = $detail ? "NULLIF(e.protocol, '')" : 'NULL';
        $transportSelect = $detail ? "NULLIF(e.transport, '')" : 'NULL';
        $serverSelect = $detail ? "NULLIF(e.server_id, '')" : 'NULL';
        $nodeSelect = $detail ? "NULLIF(e.node_region, '')" : 'NULL';
        $phaseSelect = $mode === 'phase' ? "NULLIF(e.phase_name, '')" : 'NULL';
        $detailGroup = $detail
            ? ", NULLIF(e.protocol, ''), NULLIF(e.transport, ''), NULLIF(e.server_id, ''), NULLIF(e.node_region, '')"
            : '';
        $phaseGroup = $mode === 'phase' ? ", NULLIF(e.phase_name, '')" : '';
        $modeLiteral = $this->literal($mode);
        $status = $this->dataStatusSql('e');
        $metricVersion = $this->literal((string) config('adb.funnel_aggregates.metric_version'));
        $duration = 'COALESCE(e.duration_ms, e.connected_duration_ms)';

        $sql = <<<SQL
INSERT INTO {$target} (
    summary_id, stat_date, project_id, project_code, app_identifier, platform, app_version,
    build_number, country_code, network_type, network_type_after, protocol, transport,
    server_id, node_country, phase_name, dau_users, vpn_users, vpn_session_count,
    connection_attempt_count, connection_result_count, connection_success_count,
    connection_failed_count, permission_attempt_count, permission_success_count,
    node_selection_count, valid_node_selection_count, tunnel_attempt_count,
    tunnel_success_count, connectivity_check_count, connectivity_success_count,
    protocol_fallback_count, protocol_fallback_recovered_count,
    network_switch_disconnect_count, auto_reconnect_count, auto_reconnect_success_count,
    ip_comparable_count, ip_changed_count, country_changed_count, asn_changed_count,
    phase_attempt_count, phase_success_count, phase_failed_count, duration_sample_count,
    duration_avg_ms, duration_p50_ms, duration_p95_ms, duration_p99_ms,
    post_connect_opportunity_users, post_connect_opportunity_count,
    post_connect_impression_users, post_connect_impression_count, api_event_count,
    firebase_event_count, both_source_event_count, data_status, metric_version, computed_at
)
SELECT
    SHA2(CONCAT_WS('|', e.event_date, COALESCE(e.project_code, ''), COALESCE(e.app_identifier, ''),
        COALESCE(e.platform, ''), COALESCE(e.app_version, ''), COALESCE(CAST(e.app_build AS CHAR), ''),
        COALESCE(e.country_code, ''), COALESCE(e.network_type, ''), {$modeLiteral},
        COALESCE({$protocolSelect}, ''), COALESCE({$transportSelect}, ''),
        COALESCE({$serverSelect}, ''), COALESCE({$phaseSelect}, '')), 256),
    e.event_date, MAX(e.project_id), COALESCE(e.project_code, ''), COALESCE(e.app_identifier, ''),
    NULLIF(e.platform, ''), NULLIF(e.app_version, ''), NULLIF(CAST(e.app_build AS CHAR), ''),
    NULLIF(e.country_code, ''), NULLIF(e.network_type, ''), NULL,
    {$protocolSelect}, {$transportSelect}, {$serverSelect}, {$nodeSelect}, {$phaseSelect},
    COUNT(DISTINCT CASE WHEN e.event_name = 'app_foreground' THEN NULLIF(e.my_user_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name LIKE 'vpn_%' THEN NULLIF(e.my_user_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name LIKE 'vpn_%' THEN NULLIF(e.vpn_session_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connection_start' THEN NULLIF(e.connection_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connection_result' THEN NULLIF(e.connection_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connection_result' AND LOWER(COALESCE(e.result_status, '')) = 'success' THEN NULLIF(e.connection_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connection_result' AND LOWER(COALESCE(e.result_status, '')) IN ('failed','failure','timeout','cancelled') THEN NULLIF(e.connection_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_permission_result' THEN e.event_id END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_permission_result' AND LOWER(COALESCE(e.permission_status, '')) IN ('granted','already_granted','success') THEN e.event_id END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_node_selected' THEN e.event_id END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_node_selected' AND NULLIF(e.server_id, '') IS NOT NULL THEN e.event_id END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connection_phase' AND e.phase_name IN ('tunnel_establish','node_connect') THEN NULLIF(e.connection_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connection_phase' AND e.phase_name IN ('tunnel_establish','node_connect') AND LOWER(COALESCE(e.phase_result, '')) = 'success' THEN NULLIF(e.connection_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connectivity_check' THEN e.event_id END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connectivity_check' AND LOWER(COALESCE(e.result_status, '')) = 'success' THEN e.event_id END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_protocol_fallback' THEN e.event_id END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_protocol_fallback' AND LOWER(COALESCE(e.result_status, '')) = 'success' THEN e.event_id END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_disconnection' AND LOWER(COALESCE(e.disconnect_reason, '')) LIKE '%network%' THEN e.event_id END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connection_start' AND LOWER(COALESCE(e.trigger_type, '')) = 'auto_reconnect' THEN NULLIF(e.connection_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connection_result' AND LOWER(COALESCE(e.trigger_type, '')) = 'auto_reconnect' AND LOWER(COALESCE(e.result_status, '')) = 'success' THEN NULLIF(e.connection_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_ip_probe_result' AND NULLIF(e.ip_before_connect, '') IS NOT NULL AND NULLIF(e.ip_after_connect, '') IS NOT NULL THEN COALESCE(NULLIF(e.connection_id, ''), NULLIF(e.vpn_session_id, '')) END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_ip_probe_result' AND e.ip_changed = 1 THEN COALESCE(NULLIF(e.connection_id, ''), NULLIF(e.vpn_session_id, '')) END),
    0, 0,
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connection_phase' THEN CONCAT(COALESCE(e.connection_id, ''), '|', COALESCE(e.phase_name, '')) END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connection_phase' AND LOWER(COALESCE(e.phase_result, '')) = 'success' THEN CONCAT(COALESCE(e.connection_id, ''), '|', COALESCE(e.phase_name, '')) END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'vpn_connection_phase' AND LOWER(COALESCE(e.phase_result, '')) IN ('failed','failure','timeout','cancelled') THEN CONCAT(COALESCE(e.connection_id, ''), '|', COALESCE(e.phase_name, '')) END),
    SUM(CASE WHEN e.event_name IN ('vpn_connection_phase','vpn_connection_result') AND {$duration} IS NOT NULL THEN 1 ELSE 0 END),
    CAST(AVG(CASE WHEN e.event_name IN ('vpn_connection_phase','vpn_connection_result') THEN {$duration} END) AS DECIMAL(20,4)),
    CAST(APPROX_PERCENTILE(CASE WHEN e.event_name IN ('vpn_connection_phase','vpn_connection_result') THEN {$duration} END, 0.50) AS BIGINT),
    CAST(APPROX_PERCENTILE(CASE WHEN e.event_name IN ('vpn_connection_phase','vpn_connection_result') THEN {$duration} END, 0.95) AS BIGINT),
    CAST(APPROX_PERCENTILE(CASE WHEN e.event_name IN ('vpn_connection_phase','vpn_connection_result') THEN {$duration} END, 0.99) AS BIGINT),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_opportunity' AND e.vpn_active = 1 THEN NULLIF(e.my_user_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_opportunity' AND e.vpn_active = 1 THEN NULLIF(e.opportunity_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_impression' AND e.vpn_active = 1 THEN NULLIF(e.my_user_id, '') END),
    COUNT(DISTINCT CASE WHEN e.event_name = 'ad_impression' AND e.vpn_active = 1 THEN e.event_id END),
    SUM(CASE WHEN e.api_seen = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN e.firebase_seen = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN e.api_seen = 1 AND e.firebase_seen = 1 THEN 1 ELSE 0 END),
    {$status}, {$metricVersion}, UTC_TIMESTAMP()
FROM {$source} e
{$sourceJoin}
WHERE {$sourceWhere} {$phaseCondition}
GROUP BY e.event_date, COALESCE(e.project_code, ''), COALESCE(e.app_identifier, ''),
    NULLIF(e.platform, ''), NULLIF(e.app_version, ''), NULLIF(CAST(e.app_build AS CHAR), ''),
    NULLIF(e.country_code, ''), NULLIF(e.network_type, '') {$detailGroup} {$phaseGroup}
SQL;

        return DB::connection($this->connection())->affectingStatement($sql, $bindings);
    }

    /**
     * 合并标准明细、隔离和冲突记录，生成事件质量日汇总。
     */
    private function rebuildEventQuality(string $date, ?string $projectCode): int
    {
        $targetTable = $this->table('event_quality_daily');
        $this->clearDate($targetTable, 'stat_date', $date, $projectCode);
        [$sourceProject, $sourceBindings] = $this->simpleProjectFilter('e', $projectCode, [$date]);
        [$quarantineProject, $quarantineBindings] = $this->simpleProjectFilter('q', $projectCode, [$date]);
        [$conflictProject, $conflictBindings] = $this->simpleProjectFilter('c', $projectCode, [$date]);
        $bindings = array_merge($sourceBindings, $quarantineBindings, $conflictBindings);
        $source = $this->quote($this->sourceTable());
        $quarantine = $this->quote($this->quarantineTable());
        $conflict = $this->quote($this->conflictTable());
        $target = $this->quote($targetTable);
        $metricVersion = $this->literal((string) config('adb.funnel_aggregates.metric_version'));

        $sql = <<<SQL
INSERT INTO {$target} (
    summary_id, stat_date, project_id, project_code, app_identifier, platform, app_version,
    build_number, country_code, event_name, schema_version, total_event_count,
    accepted_event_count, api_event_count, firebase_event_count, api_only_count,
    firebase_only_count, both_source_count, duplicate_count, conflict_count,
    quarantine_count, unknown_event_count, disabled_event_count, missing_event_id_count,
    invalid_event_id_count, missing_user_id_count, invalid_timestamp_count,
    type_mismatch_count, project_not_found_count, unsupported_schema_count,
    orphan_session_count, orphan_decision_count, orphan_opportunity_count,
    orphan_request_count, orphan_instance_count, orphan_vpn_session_count,
    orphan_connection_count, p0_field_total, p0_field_present, p0_completeness_rate,
    p1_field_total, p1_field_present, p1_completeness_rate, association_required_count,
    association_complete_count, association_integrity_rate, receive_delay_sample_count,
    receive_delay_avg_ms, receive_delay_p50_ms, receive_delay_p95_ms,
    receive_delay_p99_ms, firebase_export_delay_sample_count,
    firebase_export_delay_avg_ms, firebase_export_delay_p95_ms, middle_platform_dau,
    firebase_dau, dau_deviation_rate, data_status, metric_version, computed_at
)
SELECT
    SHA2(CONCAT_WS('|', x.stat_date, COALESCE(x.project_code, ''), COALESCE(x.app_identifier, ''),
        COALESCE(x.platform, ''), COALESCE(x.app_version, ''), COALESCE(x.build_number, ''),
        COALESCE(x.country_code, ''), COALESCE(x.event_name, ''), COALESCE(x.schema_version, '')), 256),
    x.stat_date, MAX(x.project_id), COALESCE(x.project_code, ''), COALESCE(x.app_identifier, ''),
    NULLIF(x.platform, ''), NULLIF(x.app_version, ''), NULLIF(x.build_number, ''),
    NULLIF(x.country_code, ''), NULLIF(x.event_name, ''), NULLIF(x.schema_version, ''),
    SUM(x.accepted_count + x.quarantine_count), SUM(x.accepted_count), SUM(x.api_count),
    SUM(x.firebase_count), SUM(x.api_only_count), SUM(x.firebase_only_count),
    SUM(x.both_count), 0, SUM(x.conflict_count), SUM(x.quarantine_count),
    SUM(x.unknown_count), SUM(x.disabled_count), SUM(x.missing_event_id_count),
    SUM(x.invalid_event_id_count), SUM(x.missing_user_id_count), SUM(x.invalid_timestamp_count),
    SUM(x.type_mismatch_count), SUM(x.project_not_found_count), SUM(x.unsupported_schema_count),
    SUM(x.orphan_session_count), SUM(x.orphan_decision_count), SUM(x.orphan_opportunity_count),
    SUM(x.orphan_request_count), SUM(x.orphan_instance_count), SUM(x.orphan_vpn_session_count),
    SUM(x.orphan_connection_count), 0, 0, NULL, 0, 0, NULL,
    SUM(x.association_required_count), SUM(x.association_complete_count),
    CAST(CASE WHEN SUM(x.association_required_count) = 0 THEN NULL
        ELSE ROUND(SUM(x.association_complete_count) / SUM(x.association_required_count), 8)
        END AS DECIMAL(20,8)),
    SUM(x.receive_delay_samples),
    CAST(CASE WHEN SUM(x.receive_delay_samples) = 0 THEN NULL
        ELSE SUM(x.receive_delay_sum) / SUM(x.receive_delay_samples)
        END AS DECIMAL(20,4)),
    CAST(APPROX_PERCENTILE(x.receive_delay_value, 0.50) AS BIGINT),
    CAST(APPROX_PERCENTILE(x.receive_delay_value, 0.95) AS BIGINT),
    CAST(APPROX_PERCENTILE(x.receive_delay_value, 0.99) AS BIGINT),
    SUM(x.firebase_delay_samples),
    CAST(CASE WHEN SUM(x.firebase_delay_samples) = 0 THEN NULL
        ELSE SUM(x.firebase_delay_sum) / SUM(x.firebase_delay_samples)
        END AS DECIMAL(20,4)),
    CAST(APPROX_PERCENTILE(x.firebase_delay_value, 0.95) AS BIGINT),
    COUNT(DISTINCT x.middle_dau_user), COUNT(DISTINCT x.firebase_dau_user),
    CAST(CASE WHEN COUNT(DISTINCT x.middle_dau_user) = 0 THEN NULL
        ELSE ABS(COUNT(DISTINCT x.firebase_dau_user) - COUNT(DISTINCT x.middle_dau_user))
            / COUNT(DISTINCT x.middle_dau_user) END AS DECIMAL(20,8)),
    CASE WHEN MAX(x.has_final) = 1 THEN 'final' WHEN MAX(x.has_firebase) = 1 THEN 'verified' ELSE 'realtime' END,
    {$metricVersion}, UTC_TIMESTAMP()
FROM (
    SELECT e.event_date AS stat_date, e.project_id, e.project_code, e.app_identifier, e.platform,
        e.app_version, CAST(e.app_build AS CHAR) AS build_number, e.country_code,
        e.event_name, e.schema_version, 1 AS accepted_count, 0 AS quarantine_count,
        e.api_seen AS api_count, e.firebase_seen AS firebase_count,
        CASE WHEN e.api_seen = 1 AND e.firebase_seen = 0 THEN 1 ELSE 0 END AS api_only_count,
        CASE WHEN e.api_seen = 0 AND e.firebase_seen = 1 THEN 1 ELSE 0 END AS firebase_only_count,
        CASE WHEN e.api_seen = 1 AND e.firebase_seen = 1 THEN 1 ELSE 0 END AS both_count,
        0 AS conflict_count, 0 AS unknown_count, 0 AS disabled_count, 0 AS missing_event_id_count,
        0 AS invalid_event_id_count, 0 AS missing_user_id_count, 0 AS invalid_timestamp_count,
        0 AS type_mismatch_count, 0 AS project_not_found_count, 0 AS unsupported_schema_count,
        CASE WHEN e.event_name NOT IN ('app_first_open','app_once_params') AND NULLIF(e.session_id, '') IS NULL THEN 1 ELSE 0 END AS orphan_session_count,
        CASE WHEN e.event_name IN ('ad_eligibility_check','ad_opportunity') AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.event_params_json, '$.decision_id')), '') IS NULL THEN 1 ELSE 0 END AS orphan_decision_count,
        CASE WHEN e.event_name IN ('ad_cache_hit','ad_cache_miss','ad_request','ad_show_attempt','ad_impression') AND NULLIF(e.opportunity_id, '') IS NULL THEN 1 ELSE 0 END AS orphan_opportunity_count,
        CASE WHEN e.event_name IN ('ad_load_success','ad_load_failed','ad_cache_put','ad_show_attempt','ad_impression') AND NULLIF(e.request_id, '') IS NULL THEN 1 ELSE 0 END AS orphan_request_count,
        CASE WHEN e.event_name IN ('ad_cache_put','ad_cache_take','ad_show_attempt','ad_impression','ad_paid_event') AND NULLIF(e.ad_instance_id, '') IS NULL THEN 1 ELSE 0 END AS orphan_instance_count,
        CASE WHEN e.event_name LIKE 'vpn_%' AND e.event_name NOT IN ('vpn_permission_result','vpn_network_diagnostic') AND NULLIF(e.vpn_session_id, '') IS NULL THEN 1 ELSE 0 END AS orphan_vpn_session_count,
        CASE WHEN e.event_name IN ('vpn_connection_phase','vpn_protocol_fallback','vpn_connection_result','vpn_connectivity_check') AND NULLIF(e.connection_id, '') IS NULL THEN 1 ELSE 0 END AS orphan_connection_count,
        CASE WHEN e.event_name IN ('ad_eligibility_check','ad_opportunity','ad_request','ad_load_success','ad_load_failed','ad_show_attempt','ad_impression','ad_paid_event','vpn_connection_phase','vpn_connection_result') THEN 1 ELSE 0 END AS association_required_count,
        CASE WHEN
            (e.event_name = 'ad_eligibility_check' AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(e.event_params_json, '$.decision_id')), '') IS NOT NULL)
            OR (e.event_name = 'ad_opportunity' AND NULLIF(e.opportunity_id, '') IS NOT NULL)
            OR (e.event_name = 'ad_request' AND NULLIF(e.request_id, '') IS NOT NULL)
            OR (e.event_name IN ('ad_load_success','ad_load_failed') AND NULLIF(e.request_id, '') IS NOT NULL)
            OR (e.event_name IN ('ad_show_attempt','ad_impression','ad_paid_event') AND NULLIF(e.ad_instance_id, '') IS NOT NULL)
            OR (e.event_name IN ('vpn_connection_phase','vpn_connection_result') AND NULLIF(e.connection_id, '') IS NOT NULL)
            THEN 1 ELSE 0 END AS association_complete_count,
        CASE WHEN e.receive_delay_ms IS NOT NULL THEN 1 ELSE 0 END AS receive_delay_samples,
        COALESCE(e.receive_delay_ms, 0) AS receive_delay_sum, e.receive_delay_ms AS receive_delay_value,
        CASE WHEN e.firebase_exported_at IS NOT NULL THEN 1 ELSE 0 END AS firebase_delay_samples,
        CASE WHEN e.firebase_exported_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, e.event_time_utc, e.firebase_exported_at) * 1000 ELSE 0 END AS firebase_delay_sum,
        CASE WHEN e.firebase_exported_at IS NOT NULL THEN TIMESTAMPDIFF(SECOND, e.event_time_utc, e.firebase_exported_at) * 1000 END AS firebase_delay_value,
        CASE WHEN e.event_name = 'app_foreground' THEN NULLIF(e.my_user_id, '') END AS middle_dau_user,
        CASE WHEN e.event_name = 'app_foreground' AND e.firebase_seen = 1 THEN NULLIF(e.my_user_id, '') END AS firebase_dau_user,
        CASE WHEN e.data_status = 'final' THEN 1 ELSE 0 END AS has_final, e.firebase_seen AS has_firebase
    FROM {$source} e
    WHERE e.event_date = ? {$sourceProject}
    UNION ALL
    SELECT q.event_date, NULL, q.project_code, q.app_identifier, q.platform, NULL, NULL, NULL,
        q.event_name_raw, q.schema_version, 0, 1,
        CASE WHEN q.source_type = 'api' THEN 1 ELSE 0 END,
        CASE WHEN q.source_type = 'firebase' THEN 1 ELSE 0 END,
        CASE WHEN q.source_type = 'api' THEN 1 ELSE 0 END,
        CASE WHEN q.source_type = 'firebase' THEN 1 ELSE 0 END, 0, 0,
        CASE WHEN q.reason_code = 'unknown_event' THEN 1 ELSE 0 END,
        CASE WHEN q.reason_code = 'event_disabled' THEN 1 ELSE 0 END,
        CASE WHEN q.reason_code = 'missing_event_id' THEN 1 ELSE 0 END,
        CASE WHEN q.reason_code = 'invalid_event_id' THEN 1 ELSE 0 END,
        CASE WHEN q.reason_code = 'missing_user_id' THEN 1 ELSE 0 END,
        CASE WHEN q.reason_code = 'invalid_timestamp' THEN 1 ELSE 0 END,
        CASE WHEN q.reason_code = 'type_mismatch' THEN 1 ELSE 0 END,
        CASE WHEN q.reason_code = 'project_not_found' THEN 1 ELSE 0 END,
        CASE WHEN q.reason_code = 'schema_unsupported' THEN 1 ELSE 0 END,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 0, 0, NULL, NULL, NULL, 0,
        CASE WHEN q.source_type = 'firebase' THEN 1 ELSE 0 END
    FROM {$quarantine} q
    WHERE q.event_date = ? {$quarantineProject}
    UNION ALL
    SELECT c.event_date, NULL, c.project_code, c.app_identifier, NULL, NULL, NULL, NULL,
        c.event_name, NULL, 0, 0, 0, 0, 0, 0, 0, 1,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        NULL, 0, 0, NULL, NULL, NULL, 0, 1
    FROM {$conflict} c
    WHERE c.event_date = ? {$conflictProject}
) x
GROUP BY x.stat_date, COALESCE(x.project_code, ''), COALESCE(x.app_identifier, ''),
    NULLIF(x.platform, ''), NULLIF(x.app_version, ''), NULLIF(x.build_number, ''),
    NULLIF(x.country_code, ''), NULLIF(x.event_name, ''), NULLIF(x.schema_version, '')
SQL;

        return DB::connection($this->connection())->affectingStatement($sql, $bindings);
    }

    /**
     * 按用户会话排序页面事件并折叠连续重复页面，生成真实页面路径。
     */
    private function rebuildScreenPaths(string $date, ?string $projectCode): int
    {
        $targetTable = $this->table('screen_path_daily');
        $this->clearDate($targetTable, 'stat_date', $date, $projectCode);
        [$sourceJoin, $sourceWhere, $bindings] = $this->sourceScope($date, $projectCode, 'e');
        [$metricSourceJoin, $metricSourceWhere, $metricBindings] = $this->sourceScope($date, $projectCode, 'm');
        $bindings = array_merge($bindings, $metricBindings);
        $source = $this->quote($this->sourceTable());
        $target = $this->quote($targetTable);
        $metricVersion = $this->literal((string) config('adb.funnel_aggregates.metric_version'));

        $sql = <<<SQL
INSERT INTO {$target} (
    path_summary_id, stat_date, project_id, project_code, app_identifier, platform,
    app_version, build_number, country_code, network_type, path_hash, path_text,
    start_screen, end_screen, path_step_count, session_count, user_count,
    screen_view_count, screen_exit_count, ad_opportunity_count, ad_impression_count,
    revenue_micros, api_event_count, firebase_event_count, both_source_event_count,
    data_status, metric_version, computed_at
)
SELECT
    SHA2(CONCAT_WS('|', p.stat_date, p.project_code, p.app_identifier, COALESCE(p.platform, ''),
        COALESCE(p.app_version, ''), COALESCE(p.build_number, ''), COALESCE(p.country_code, ''),
        COALESCE(p.network_type, ''), SHA2(p.path_text, 256)), 256),
    p.stat_date, MAX(p.project_id), p.project_code, p.app_identifier, p.platform,
    p.app_version, p.build_number, p.country_code, p.network_type,
    SHA2(p.path_text, 256), LEFT(p.path_text, 2048),
    SUBSTRING_INDEX(p.path_text, ' > ', 1), SUBSTRING_INDEX(p.path_text, ' > ', -1),
    CAST(MAX(p.path_step_count) AS INTEGER),
    COUNT(DISTINCT CONCAT(p.my_user_id, '|', p.session_id)),
    COUNT(DISTINCT p.my_user_id),
    COUNT(DISTINCT CASE WHEN m.event_name = 'screen_view' THEN m.event_id END),
    COUNT(DISTINCT CASE WHEN m.event_name = 'screen_exit' THEN m.event_id END),
    COUNT(DISTINCT CASE WHEN m.event_name = 'ad_opportunity' THEN NULLIF(m.opportunity_id, '') END),
    COUNT(DISTINCT CASE WHEN m.event_name = 'ad_impression' THEN m.event_id END),
    SUM(CASE WHEN m.event_name = 'ad_paid_event' THEN COALESCE(m.value_micros, 0) ELSE 0 END),
    SUM(CASE WHEN m.api_seen = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN m.firebase_seen = 1 THEN 1 ELSE 0 END),
    SUM(CASE WHEN m.api_seen = 1 AND m.firebase_seen = 1 THEN 1 ELSE 0 END),
    CASE WHEN MAX(CASE WHEN m.data_status = 'final' THEN 1 ELSE 0 END) = 1 THEN 'final'
        WHEN MAX(m.firebase_seen) = 1 THEN 'verified' ELSE 'realtime' END,
    {$metricVersion}, UTC_TIMESTAMP()
FROM (
    SELECT o.stat_date, MAX(o.project_id) AS project_id, o.project_code, o.app_identifier,
        o.platform, o.app_version, o.build_number, o.country_code, o.network_type,
        o.my_user_id, o.session_id,
        GROUP_CONCAT(o.screen_name ORDER BY o.event_time_utc, o.client_sequence, o.event_id SEPARATOR ' > ') AS path_text,
        COUNT(*) AS path_step_count, SUM(o.original_count) AS screen_view_count,
        SUM(o.api_seen) AS api_event_count, SUM(o.firebase_seen) AS firebase_event_count,
        SUM(CASE WHEN o.api_seen = 1 AND o.firebase_seen = 1 THEN 1 ELSE 0 END) AS both_source_event_count,
        MAX(CASE WHEN o.data_status = 'final' THEN 1 ELSE 0 END) AS has_final,
        MAX(o.firebase_seen) AS has_firebase
    FROM (
        SELECT z.*
        FROM (
            SELECT e.event_date AS stat_date, e.project_id, COALESCE(e.project_code, '') AS project_code,
                COALESCE(e.app_identifier, '') AS app_identifier, NULLIF(e.platform, '') AS platform,
                NULLIF(e.app_version, '') AS app_version, NULLIF(CAST(e.app_build AS CHAR), '') AS build_number,
                NULLIF(e.country_code, '') AS country_code, NULLIF(e.network_type, '') AS network_type,
                e.my_user_id, e.session_id, e.event_id, e.event_time_utc, e.client_sequence,
                e.screen_name, e.api_seen, e.firebase_seen, e.data_status, 1 AS original_count,
                LAG(e.screen_name) OVER (
                    PARTITION BY e.event_date, e.app_identifier, e.my_user_id, e.session_id
                    ORDER BY e.event_time_utc, e.client_sequence, e.event_id
                ) AS previous_screen_name
            FROM {$source} e
            {$sourceJoin}
            WHERE {$sourceWhere}
              AND e.event_name = 'screen_view'
              AND NULLIF(e.my_user_id, '') IS NOT NULL
              AND NULLIF(e.session_id, '') IS NOT NULL
              AND NULLIF(e.screen_name, '') IS NOT NULL
        ) z
        WHERE z.previous_screen_name IS NULL OR z.previous_screen_name <> z.screen_name
    ) o
    GROUP BY o.stat_date, o.project_code, o.app_identifier, o.platform, o.app_version,
        o.build_number, o.country_code, o.network_type, o.my_user_id, o.session_id
) p
JOIN {$source} m ON m.event_date = p.stat_date AND m.app_identifier = p.app_identifier
    AND m.my_user_id = p.my_user_id AND m.session_id = p.session_id
{$metricSourceJoin}
WHERE p.path_text IS NOT NULL AND p.path_text <> '' AND {$metricSourceWhere}
GROUP BY p.stat_date, p.project_code, p.app_identifier, p.platform, p.app_version,
    p.build_number, p.country_code, p.network_type, p.path_text
SQL;

        return DB::connection($this->connection())->affectingStatement($sql, $bindings);
    }

    /**
     * Firebase Daily 已落地的 App 日期仅使用 firebase_seen 事件；其余日期使用去重后的实时并集。
     *
     * @return array{0:string,1:string,2:array<int,mixed>}
     */
    private function sourceScope(string $date, ?string $projectCode, string $alias): array
    {
        $source = $this->quote($this->sourceTable());
        $projectFinal = '';
        $projectMain = '';
        $bindings = [$date];
        if ($projectCode !== null && $projectCode !== '') {
            $projectFinal = ' AND project_code = ?';
            $bindings[] = $projectCode;
        }
        $bindings[] = $date;
        if ($projectCode !== null && $projectCode !== '') {
            $projectMain = " AND {$alias}.project_code = ?";
            $bindings[] = $projectCode;
        }

        $join = <<<SQL
LEFT JOIN (
    SELECT app_identifier,
        MAX(CASE WHEN data_status = 'final' AND firebase_seen = 1 THEN 1 ELSE 0 END) AS has_final
    FROM {$source}
    WHERE event_date = ? {$projectFinal}
    GROUP BY app_identifier
) final_source ON final_source.app_identifier = {$alias}.app_identifier
SQL;
        $where = "{$alias}.event_date = ? {$projectMain}\n"
            . "  AND (COALESCE(final_source.has_final, 0) = 0 OR {$alias}.firebase_seen = 1)";

        return [$join, $where, $bindings];
    }

    private function dataStatusSql(string $alias): string
    {
        return "CASE WHEN MAX(CASE WHEN {$alias}.data_status = 'final' THEN 1 ELSE 0 END) = 1 THEN 'final' "
            . "WHEN MAX({$alias}.firebase_seen) = 1 THEN 'verified' ELSE 'realtime' END";
    }

    private function clearDate(string $table, string $dateColumn, string $date, ?string $projectCode): void
    {
        $sql = 'DELETE FROM ' . $this->quote($table) . ' WHERE ' . $this->quote($dateColumn) . ' = ?';
        $bindings = [$date];
        if ($projectCode !== null && $projectCode !== '') {
            $sql .= ' AND project_code = ?';
            $bindings[] = $projectCode;
        }
        DB::connection($this->connection())->delete($sql, $bindings);
    }

    /** @param array<int, mixed> $bindings @return array{0:string,1:array<int,mixed>} */
    private function simpleProjectFilter(string $alias, ?string $projectCode, array $bindings): array
    {
        if ($projectCode === null || $projectCode === '') {
            return ['', $bindings];
        }
        $bindings[] = $projectCode;
        return ["AND {$alias}.project_code = ?", $bindings];
    }

    /** @param array<int, array<string, mixed>> $rows */
    private function insertRows(string $table, array $rows): int
    {
        $count = 0;
        $batchSize = max(1, min(1000, (int) config('adb.funnel_aggregates.insert_batch_size', 200)));
        foreach (array_chunk($rows, $batchSize) as $batch) {
            DB::connection($this->connection())->table($table)->insert($batch);
            $count += count($batch);
        }
        return $count;
    }

    /** @return array<string, mixed> */
    private function stageDimensions(array $row, bool $hourly): array
    {
        $dimensions = [
            'stat_date' => $row['stat_date'],
        ];
        if ($hourly) {
            $dimensions['stat_hour'] = $row['stat_hour'];
        }
        return $dimensions + [
            'project_id' => $row['project_id'] !== null ? (int) $row['project_id'] : null,
            'project_code' => (string) $row['project_code'],
            'app_identifier' => (string) $row['app_identifier'],
            'platform' => $row['platform'],
            'app_version' => $row['app_version'],
            'build_number' => $row['build_number'],
            'country_code' => $row['country_code'],
            'network_type' => $row['network_type'],
            'funnel_version_id' => (string) $row['funnel_version_id'],
            'funnel_code' => (string) $row['funnel_code'],
            'scope_type' => (string) $row['scope_type'],
            'step_code' => (string) $row['step_code'],
            'step_order' => (int) $row['step_order'],
        ];
    }

    private function stageKey(array $row, bool $includeStepCode, ?int $stepOrder = null): string
    {
        $values = [
            $row['stat_date'] ?? '', $row['stat_hour'] ?? '', $row['project_code'] ?? '',
            $row['app_identifier'] ?? '', $row['platform'] ?? '', $row['app_version'] ?? '',
            $row['build_number'] ?? '', $row['country_code'] ?? '', $row['network_type'] ?? '',
            $row['funnel_version_id'] ?? '', $row['funnel_code'] ?? '', $row['scope_type'] ?? '',
            $stepOrder ?? ($row['step_order'] ?? ''),
        ];
        if ($includeStepCode) {
            $values[] = $row['step_code'] ?? '';
        }
        return implode('|', $values);
    }

    private function previousStepCode(string $funnelCode, int $stepOrder): ?string
    {
        foreach (self::FUNNELS as $funnel) {
            if ($funnel['code'] === $funnelCode) {
                return $funnel['steps'][$stepOrder - 2]['code'] ?? null;
            }
        }
        return null;
    }

    private function statusFromFlags(array $row): string
    {
        if ((int) ($row['has_final'] ?? 0) === 1) {
            return 'final';
        }
        return (int) ($row['has_firebase'] ?? 0) === 1 ? 'verified' : 'realtime';
    }

    private function jsonText(string $column, string $path): string
    {
        if (preg_match('/^[A-Za-z0-9_]+$/', $path) !== 1) {
            throw new RuntimeException("Invalid JSON path field: {$path}");
        }
        return "JSON_UNQUOTE(JSON_EXTRACT({$column}, '$.{$path}'))";
    }

    private function assertReady(): void
    {
        foreach (array_merge([$this->sourceTable(), $this->quarantineTable(), $this->conflictTable()], array_values($this->tables())) as $table) {
            $this->assertIdentifier($table);
            $exists = DB::connection($this->connection())->selectOne(
                'SELECT COUNT(*) AS aggregate_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
                [$table]
            );
            $count = (int) ((array) $exists)['aggregate_count'];
            if ($count < 1) {
                throw new RuntimeException("ADB table does not exist: {$table}");
            }
        }
    }

    /** @return array<string, string> */
    private function tables(): array
    {
        return array_map(
            fn ($table): string => $this->validatedIdentifier((string) $table),
            (array) config('adb.funnel_aggregates.tables', [])
        );
    }

    private function table(string $key): string
    {
        $tables = $this->tables();
        if (!isset($tables[$key])) {
            throw new RuntimeException("Missing funnel aggregate table config: {$key}");
        }
        return $tables[$key];
    }

    private function sourceTable(): string
    {
        return $this->validatedIdentifier((string) config('adb.tracking_events.event_table', 'dwd_app_tracking_event'));
    }

    private function quarantineTable(): string
    {
        return $this->validatedIdentifier((string) config('adb.tracking_events.quarantine_table', 'dwd_app_tracking_event_quarantine'));
    }

    private function conflictTable(): string
    {
        return $this->validatedIdentifier((string) config('adb.tracking_events.conflict_table', 'dwd_app_tracking_event_conflict'));
    }

    private function quote(string $identifier): string
    {
        return '`' . $this->validatedIdentifier($identifier) . '`';
    }

    private function validatedIdentifier(string $identifier): string
    {
        $this->assertIdentifier($identifier);
        return $identifier;
    }

    private function assertIdentifier(string $identifier): void
    {
        if (preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $identifier) !== 1) {
            throw new RuntimeException("Invalid ADB identifier: {$identifier}");
        }
    }

    private function literal(string $value): string
    {
        return "'" . str_replace("'", "''", $value) . "'";
    }
}
