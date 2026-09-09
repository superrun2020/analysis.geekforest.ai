<?php

namespace App\Services;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Throwable;

class FunnelAnalyticsService
{
    private const BUILTIN_VERSION_ID = 'builtin-jkcl-v1.7';

    private const FUNNEL_STEPS = [
        ['code' => 'dau', 'name' => '日活跃用户', 'event' => 'app_foreground'],
        ['code' => 'eligibility', 'name' => '广告资格检查', 'event' => 'ad_eligibility_check'],
        ['code' => 'eligible', 'name' => '符合广告资格', 'event' => 'ad_eligibility_check', 'eligible' => true],
        ['code' => 'opportunity', 'name' => '广告机会', 'event' => 'ad_opportunity'],
        ['code' => 'request', 'name' => '广告请求用户', 'event' => 'ad_request', 'branch' => true],
        ['code' => 'show_attempt', 'name' => '展示尝试用户', 'event' => 'ad_show_attempt', 'branch' => true],
        ['code' => 'impression', 'name' => '广告展示独立用户', 'event' => 'ad_impression'],
        ['code' => 'paid', 'name' => '广告价值用户', 'event' => 'ad_paid_event'],
    ];

    private const VPN_FUNNEL_STEPS = [
        ['code' => 'dau', 'name' => '日活跃用户', 'event' => 'app_foreground'],
        ['code' => 'connect_attempt', 'name' => '连接尝试', 'event' => 'vpn_connection_start'],
        ['code' => 'connect_success', 'name' => '连接成功', 'event' => 'vpn_connection_result'],
        ['code' => 'post_connect_opportunity', 'name' => '连接后广告机会', 'event' => 'ad_opportunity'],
        ['code' => 'post_connect_impression', 'name' => '连接后广告展示', 'event' => 'ad_impression'],
    ];

    private const ADS_EVENT_FUNNEL_STEPS = [
        ['code' => 'opportunity', 'name' => 'Opportunity', 'event' => 'ad_opportunity'],
        ['code' => 'cache_hit', 'name' => 'Cache Hit', 'event' => 'ad_cache_hit', 'branch' => true],
        ['code' => 'realtime_request', 'name' => 'Realtime Request', 'event' => 'ad_request', 'branch' => true],
        [
            'code' => 'request_accepted',
            'name' => 'Request Accepted',
            'event' => 'V1.7 未定义独立事件',
            'available' => false,
            'unavailableReason' => 'V1.7 事件明细未定义 Request Accepted 独立事件，不能用 ad_request 代替',
        ],
        ['code' => 'load_success', 'name' => 'Load Success', 'event' => 'ad_load_success'],
        ['code' => 'ad_ready', 'name' => 'Ad Ready', 'event' => 'ad_ready'],
        ['code' => 'show_attempt', 'name' => 'Show Attempt', 'event' => 'ad_show_attempt'],
        ['code' => 'impression', 'name' => 'Impression', 'event' => 'ad_impression'],
        ['code' => 'paid', 'name' => 'Paid Event', 'event' => 'ad_paid_event'],
    ];

    private const METRIC_DICTIONARY = [
        ['code' => 'dau', 'name' => '日活跃用户数', 'formula' => 'COUNT(DISTINCT my_user_id)，事件为 app_foreground', 'source' => 'dwd_app_tracking_event'],
        ['code' => 'ad_viewer_rate', 'name' => '广告浏览者比例', 'formula' => '广告展示独立用户 / DAU', 'source' => 'ad_impression + app_foreground'],
        ['code' => 'opportunity_coverage', 'name' => 'Opportunity 覆盖率', 'formula' => '广告机会用户 / DAU', 'source' => 'ad_opportunity + app_foreground'],
        ['code' => 'impressions_per_viewer', 'name' => '人均展示次数', 'formula' => 'ad_impression 事件数 / 广告展示独立用户', 'source' => 'ad_impression'],
        ['code' => 'revenue', 'name' => '广告收入', 'formula' => 'SUM(value_micros) / 1,000,000', 'source' => 'ad_paid_event'],
        ['code' => 'fulfillment_rate', 'name' => '机会履约率', 'formula' => 'ad_show_attempt 事件数 / ad_opportunity 事件数', 'source' => 'ad_opportunity + ad_show_attempt'],
    ];

    private const CORE_METRIC_EVENTS = [
        'app_foreground',
        'ad_eligibility_check',
        'ad_opportunity',
        'ad_request',
        'ad_load_success',
        'ad_load_failed',
        'ad_cache_hit',
        'ad_cache_miss',
        'ad_show_attempt',
        'ad_impression',
        'ad_paid_event',
    ];

    /** Return the lightweight project selector without calculating every analysis dimension. */
    public function projects(): array
    {
        return Cache::remember('jkcl_funnel:projects:firebase-first:v18', 300, function (): array {
            $firebaseProjects = $this->firebaseConfiguredProjects(['ACTIVE']);
            if ($firebaseProjects) {
                return $firebaseProjects;
            }

            return $this->firebaseConfiguredProjects(null);
        });
    }

    /**
     * Resolve legacy/manual project codes to the canonical Firebase-bound code.
     *
     * Operators sometimes open old links with codes like "006A" while the
     * Firebase binding table stores the canonical project as "A006A". Normalize
     * at the API boundary so every page, share link, and retry path hits the
     * same online project instead of querying an empty partition.
     */
    public function resolveProjectCode(?string $projectCode): ?string
    {
        $raw = trim((string) $projectCode);
        if ($raw === '') {
            return $projectCode;
        }

        $projects = $this->projects();
        $canonicalCodes = array_values(array_filter(array_map(
            fn (array $project): string => trim((string) ($project['projectCode'] ?? '')),
            $projects
        )));

        if (in_array($raw, $canonicalCodes, true)) {
            return $raw;
        }

        $upper = strtoupper($raw);
        foreach ($canonicalCodes as $code) {
            if (strtoupper($code) === $upper) {
                return $code;
            }
        }

        foreach ($canonicalCodes as $code) {
            if (strtoupper($code) === 'A' . $upper) {
                return $code;
            }
        }

        $unprefixed = str_starts_with($upper, 'A') ? substr($upper, 1) : $upper;
        foreach ($canonicalCodes as $code) {
            if (preg_replace('/^A/i', '', strtoupper($code)) === $unprefixed) {
                return $code;
            }
        }

        return $raw;
    }

    /**
     * Project selector must follow Firebase bindings, not the broader ADB mapping dimension.
     *
     * @param array<int, string>|null $bindingStatuses null means every non-disabled binding.
     * @return array<int, array<string, mixed>>
     */
    private function firebaseConfiguredProjects(?array $bindingStatuses): array
    {
        try {
            $connectionName = $this->firebaseControlConnectionName();
            if ($connectionName === null) {
                return [];
            }

            $schema = Schema::connection($connectionName);
            $db = DB::connection($connectionName);
            foreach (['firebase_connections', 'firebase_remote_projects', 'firebase_remote_apps', 'firebase_project_bindings'] as $table) {
                if (!$schema->hasTable($table)) {
                    return [];
                }
            }

            $hasProjects = $schema->hasTable('project_projects');
            $query = $db->table('firebase_project_bindings as binding')
                ->join('firebase_remote_apps as app', 'app.id', '=', 'binding.firebase_app_pk')
                ->join('firebase_remote_projects as remote_project', 'remote_project.id', '=', 'app.firebase_project_pk')
                ->join('firebase_connections as connection', 'connection.id', '=', 'remote_project.connection_id');

            if ($hasProjects) {
                $query->leftJoin('project_projects as project', function ($join): void {
                    $join->on('project.id', '=', 'binding.internal_project_id')
                        ->orOn('project.project_code', '=', 'binding.project_code');
                });
            }

            if ($bindingStatuses === null) {
                $query->where('binding.status', '!=', 'DISABLED');
            } else {
                $query->whereIn('binding.status', $bindingStatuses);
            }

            $query->whereIn('connection.status', ['ACTIVE', 'DEGRADED'])
                ->whereIn('app.status', ['ACTIVE', 'NO_DATA'])
                ->whereIn('remote_project.status', ['ACTIVE', 'NO_DATA'])
                ->whereNotNull('binding.project_code')
                ->where('binding.project_code', '!=', '')
                ->whereNull('binding.disabled_at');

            $nameExpressions = [
                $hasProjects && $schema->hasColumn('project_projects', 'app_name') ? "MAX(NULLIF(project.app_name, ''))" : 'NULL',
                $hasProjects && $schema->hasColumn('project_projects', 'project_name') ? "MAX(NULLIF(project.project_name, ''))" : 'NULL',
                "MAX(NULLIF(app.display_name, ''))",
                "MAX(NULLIF(connection.connection_name, ''))",
                'binding.project_code',
            ];
            $appIdentifierExpressions = [
                "MAX(NULLIF(app.app_identifier, ''))",
                $hasProjects && $schema->hasColumn('project_projects', 'package_name') ? "MAX(NULLIF(project.package_name, ''))" : 'NULL',
            ];

            return $query
                ->selectRaw('binding.project_code AS project_code')
                ->selectRaw('COALESCE(' . implode(', ', $nameExpressions) . ') AS app_name')
                ->selectRaw('COALESCE(' . implode(', ', $appIdentifierExpressions) . ') AS app_identifier')
                ->selectRaw('LOWER(MAX(app.platform)) AS platform')
                ->selectRaw('COUNT(DISTINCT binding.id) AS firebase_binding_count')
                ->selectRaw('MAX(binding.status) AS firebase_binding_status')
                ->selectRaw('MAX(connection.status) AS firebase_connection_status')
                ->selectRaw('MAX(remote_project.firebase_project_id) AS firebase_project_id')
                ->selectRaw('MAX(app.firebase_app_id) AS firebase_app_id')
                ->selectRaw("'firebase_bindings' AS project_source")
                ->groupBy('binding.project_code')
                ->orderBy('binding.project_code')
                ->get()
                ->map(fn ($row) => [
                    'projectCode' => (string) $row->project_code,
                    'appName' => (string) ($row->app_name ?? $row->project_code),
                    'appIdentifier' => (string) ($row->app_identifier ?? ''),
                    'platform' => (string) ($row->platform ?? ''),
                    'firebaseBindingCount' => (int) ($row->firebase_binding_count ?? 0),
                    'firebaseBindingStatus' => (string) ($row->firebase_binding_status ?? ''),
                    'firebaseConnectionStatus' => (string) ($row->firebase_connection_status ?? ''),
                    'firebaseProjectId' => (string) ($row->firebase_project_id ?? ''),
                    'firebaseAppId' => (string) ($row->firebase_app_id ?? ''),
                    'projectSource' => (string) ($row->project_source ?? 'firebase_bindings'),
                ])->all();
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * Firebase control tables may live in a dedicated operational database.
     * Detect the first configured connection that has the complete binding graph.
     */
    private function firebaseControlConnectionName(): ?string
    {
        foreach (['mysql', 'firebase_adb', 'ad_revenue'] as $connectionName) {
            try {
                $schema = Schema::connection($connectionName);
                $ready = true;
                foreach (['firebase_connections', 'firebase_remote_projects', 'firebase_remote_apps', 'firebase_project_bindings'] as $table) {
                    if (!$schema->hasTable($table)) {
                        $ready = false;
                        break;
                    }
                }

                if ($ready) {
                    return $connectionName;
                }
            } catch (Throwable) {
                continue;
            }
        }

        return null;
    }

    /**
     * Build filter options from real standardized events without scanning event payload JSON.
     */
    public function options(): array
    {
        $table = 'dws_app_funnel_stage_daily';
        $connection = DB::connection('adb');
        $projects = $this->projects();

        $today = Carbon::now(config('app.timezone', 'Asia/Shanghai'))->toDateString();
        $dimensions = $connection->table($table)
            ->where('stat_date', '<=', $today)
            ->selectRaw('MIN(stat_date) AS min_date, MAX(stat_date) AS max_date')
            ->first();

        return [
            'projects' => $projects,
            'platforms' => $this->summaryDistinctValues('platform'),
            'countries' => $this->summaryDistinctValues('country_code'),
            'appVersions' => $this->summaryDistinctValues('app_version'),
            'buildNumbers' => $this->summaryDistinctValues('build_number', 100, false),
            'versions' => $this->summaryVersionOptions(),
            'networkTypes' => $this->summaryDistinctValues('network_type'),
            'placements' => $this->summaryDistinctValues('placement', table: 'dws_ad_fulfillment_daily'),
            'adFormats' => $this->summaryDistinctValues('ad_format', table: 'dws_ad_fulfillment_daily'),
            'adSources' => $this->summaryDistinctValues('ad_source', table: 'dws_ad_fulfillment_daily'),
            'eventModules' => [],
            'qualityStatuses' => $this->summaryDistinctValues('data_status'),
            'sourceTypes' => $this->summarySourceTypeOptions(),
            'events' => DB::connection('adb')->table('dws_app_event_quality_daily')
                ->whereNotNull('event_name')->where('event_name', '!=', '')
                ->distinct()->orderBy('event_name')->limit(200)->pluck('event_name')->values()->all(),
            'dateRange' => [
                'min' => $dimensions?->min_date,
                'max' => $dimensions?->max_date,
            ],
            'metricDictionary' => self::METRIC_DICTIONARY,
        ];
    }

    /**
     * Return per-project daily session volume for date picking.
     *
     * The UI uses this as a lightweight preflight table: operators can choose a
     * date with real sessions before launching expensive workbench/path queries.
     * Prefer DWS session aggregates when ETL has produced them; otherwise fall
     * back to the V1.8 DWD detail table and count distinct session identifiers.
     */
    public function dateSessionSummary(array $params): array
    {
        if (!empty($params['projectCode'])) {
            $params['projectCode'] = $this->resolveProjectCode((string) $params['projectCode']);
        }

        $timezone = config('app.timezone', 'Asia/Shanghai');
        $dateFrom = Carbon::parse((string) $params['dateFrom'], $timezone)->toDateString();
        $dateTo = Carbon::parse((string) $params['dateTo'], $timezone)->toDateString();
        $domain = (string) ($params['domain'] ?? 'ads');
        $normalized = array_replace($params, [
            'dateFrom' => $dateFrom,
            'dateTo' => $dateTo,
            'domain' => $domain,
        ]);

        $cacheKey = 'jkcl_funnel:date_session_summary:' . md5(json_encode($normalized, JSON_UNESCAPED_UNICODE));
        $cacheTtl = $dateTo < Carbon::now($timezone)->toDateString() ? 21600 : 180;

        return Cache::remember($cacheKey, $cacheTtl, function () use ($normalized, $dateFrom, $dateTo, $domain, $timezone): array {
            $rows = $this->dateSessionSummaryFromDws($normalized, $domain);
            $source = 'dws_app_funnel_stage_daily_v18';
            $usedFallback = false;

            // Never scan the DWD detail table merely because the historical DWS
            // has not produced session-scope rows. User-scope DWS is still a
            // valid, fast readiness signal for the date picker.
            if (empty($rows) && $dateTo >= Carbon::now($timezone)->toDateString()) {
                $rows = $this->dateSessionSummaryFromDwd($normalized, $domain);
                $source = $this->eventTable();
                $usedFallback = true;
            }

            $rows = collect($rows)
                ->map(fn ($row): array => [
                    'date' => (string) $row['date'],
                    'projectCode' => (string) ($row['project_code'] ?? $normalized['projectCode'] ?? ''),
                    'appIdentifier' => (string) ($row['app_identifier'] ?? $normalized['appIdentifier'] ?? ''),
                    'platform' => (string) ($row['platform'] ?? $normalized['platform'] ?? ''),
                    'sessionCount' => (int) ($row['session_count'] ?? 0),
                    'userCount' => (int) ($row['user_count'] ?? 0),
                    'eventCount' => (int) ($row['event_count'] ?? 0),
                    'latestEventAt' => $row['latest_event_at'] ?? null,
                    'computedAt' => $row['computed_at'] ?? null,
                    'source' => $source,
                    'fallback' => $usedFallback,
                ])
                ->sortByDesc('date')
                ->values();

            if (!empty($normalized['projectCode'])) {
                $rowsByDate = $rows->keyBy('date');
                $rows = collect(CarbonPeriod::create($dateFrom, $dateTo))
                    ->map(function ($date) use ($rowsByDate, $normalized, $source, $usedFallback): array {
                        $dateString = $date->toDateString();
                        return $rowsByDate->get($dateString) ?? [
                            'date' => $dateString,
                            'projectCode' => (string) ($normalized['projectCode'] ?? ''),
                            'appIdentifier' => (string) ($normalized['appIdentifier'] ?? ''),
                            'platform' => (string) ($normalized['platform'] ?? ''),
                            'sessionCount' => 0,
                            'userCount' => 0,
                            'eventCount' => 0,
                            'latestEventAt' => null,
                            'computedAt' => null,
                            'source' => $source,
                            'fallback' => $usedFallback,
                        ];
                    })
                    ->sortByDesc('date')
                    ->values();
            }

            $best = $rows->reduce(function (?array $best, array $row): array {
                if ($best === null) {
                    return $row;
                }

                $rowSessionCount = (int) ($row['sessionCount'] ?? 0);
                $bestSessionCount = (int) ($best['sessionCount'] ?? 0);
                if ($rowSessionCount > $bestSessionCount) {
                    return $row;
                }
                if ($rowSessionCount === $bestSessionCount && (string) ($row['date'] ?? '') > (string) ($best['date'] ?? '')) {
                    return $row;
                }

                return $best;
            });

            return [
                'dateFrom' => $dateFrom,
                'dateTo' => $dateTo,
                'domain' => $domain,
                'projectCode' => (string) ($normalized['projectCode'] ?? ''),
                'rows' => $rows->all(),
                'bestDate' => $best['date'] ?? null,
                'bestSessionCount' => (int) ($best['sessionCount'] ?? 0),
                'totalSessionCount' => (int) $rows->sum('sessionCount'),
                'source' => $source,
                'fallback' => $usedFallback,
                'queriedAt' => Carbon::now($timezone)->toDateTimeString(),
                'usageHint' => '日期选择优先看 sessionCount 较高的日期；今天数据可能来自实时明细，昨天及以前优先使用汇总表。',
            ];
        });
    }

    /** @return array<int, array<string, mixed>> */
    private function dateSessionSummaryFromDws(array $params, string $domain): array
    {
        try {
            // ADB rejects SHOW/DESCRIBE when PDO native prepares are enabled.
            // Query the known DWS table directly and let the catch block handle
            // genuinely missing/unavailable tables. Otherwise hasTable() always
            // fails and silently forces a very expensive DWD detail-table scan.
            $query = DB::connection('adb')->table('dws_app_funnel_stage_daily_v18')
                ->whereBetween('stat_date', [$params['dateFrom'], $params['dateTo']])
                ->whereIn('scope_type', ['sessions', 'users'])
                ->where('step_order', 1);

            $this->applySummaryProjectFilters($query, $params);
            $this->applySummaryDomainFilter($query, $domain);

            return $query
                ->selectRaw('stat_date AS date')
                ->selectRaw('project_code')
                ->selectRaw('MAX(app_identifier) AS app_identifier')
                ->selectRaw('MAX(platform) AS platform')
                ->selectRaw("SUM(CASE WHEN scope_type = 'sessions' THEN subject_count ELSE 0 END) AS session_count")
                ->selectRaw("SUM(CASE WHEN scope_type = 'users' THEN subject_count ELSE 0 END) AS user_count")
                ->selectRaw('SUM(event_count) AS event_count')
                ->selectRaw('MAX(computed_at) AS computed_at')
                ->groupBy('stat_date', 'project_code')
                ->orderByDesc('stat_date')
                ->limit(3000)
                ->get()
                ->map(fn ($row): array => (array) $row)
                ->all();
        } catch (Throwable $exception) {
            Log::warning('jkcl_funnel_date_session_summary_dws_failed', [
                'message' => $exception->getMessage(),
                'domain' => $domain,
            ]);

            return [];
        }
    }

    /** @return array<int, array<string, mixed>> */
    private function dateSessionSummaryFromDwd(array $params, string $domain): array
    {
        $sessionExpression = $domain === 'vpn'
            ? "COALESCE(NULLIF(vpn_session_id, ''), NULLIF(session_id, ''))"
            : "NULLIF(session_id, '')";

        $query = $this->baseQuery($params);
        if ($domain === 'vpn') {
            $query->where(function (Builder $inner): void {
                $inner->where(function (Builder $withVpnSession): void {
                    $withVpnSession->whereNotNull('vpn_session_id')->where('vpn_session_id', '!=', '');
                })->orWhere('event_name', 'like', 'vpn_%');
            });
        } elseif ($domain === 'ads') {
            $query->whereIn('event_name', self::CORE_METRIC_EVENTS);
        }

        return $query
            ->selectRaw('event_date AS date')
            ->selectRaw('project_code')
            ->selectRaw('MAX(app_identifier) AS app_identifier')
            ->selectRaw('MAX(platform) AS platform')
            ->selectRaw("COUNT(DISTINCT {$sessionExpression}) AS session_count")
            ->selectRaw("COUNT(DISTINCT NULLIF(my_user_id, '')) AS user_count")
            ->selectRaw('COUNT(DISTINCT event_id) AS event_count')
            ->selectRaw('MAX(event_time_utc) AS latest_event_at')
            ->groupBy('event_date', 'project_code')
            ->orderByDesc('event_date')
            ->limit(3000)
            ->get()
            ->map(fn ($row): array => (array) $row)
            ->all();
    }

    private function applySummaryProjectFilters(Builder $query, array $params): void
    {
        foreach (['projectCode' => 'project_code', 'appIdentifier' => 'app_identifier', 'platform' => 'platform', 'country' => 'country_code', 'appVersion' => 'app_version'] as $key => $column) {
            if (!empty($params[$key])) {
                $query->where($column, $params[$key]);
            }
        }

        if (empty($params['projectCode']) && !empty($params['projectCodes'])) {
            $query->whereIn('project_code', $params['projectCodes']);
        }
    }

    private function applySummaryDomainFilter(Builder $query, string $domain): void
    {
        if ($domain === 'vpn') {
            $query->where('funnel_code', 'like', 'vpn%');
            return;
        }

        if ($domain === 'ads') {
            $query->where('funnel_code', 'like', 'ad%');
        }
    }

    /**
     * Return event-level online coverage for tracking acceptance.
     * Uses the DWS quality summary first, and falls back to DWD detail only for
     * events missing from the summary table.
     */
    public function trackingEventCoverage(array $payload): array
    {
        $projectCode = $this->normalizeShareString($payload['projectCode'] ?? null, 64);
        $appIdentifier = $this->normalizeShareString($payload['appIdentifier'] ?? null, 191);
        $date = Carbon::parse((string) $payload['date'], config('app.timezone', 'Asia/Shanghai'))->toDateString();
        $requestedEvents = collect($payload['eventNames'] ?? [])
            ->map(fn ($event) => $this->normalizeTrackingEventName((string) $event))
            ->filter()
            ->unique()
            ->values()
            ->all();

        if ($projectCode === '' || empty($requestedEvents)) {
            throw new InvalidArgumentException('项目和应测事件不能为空');
        }

        $eventsByName = [];
        foreach ($requestedEvents as $eventName) {
            $eventsByName[$eventName] = [
                'eventName' => $eventName,
                'received' => false,
                'eventCount' => 0,
                'acceptedCount' => 0,
                'users' => 0,
                'quarantineCount' => 0,
                'typeMismatchCount' => 0,
                'p0FieldTotal' => 0,
                'p0FieldPresent' => 0,
                'p0CompletenessRate' => null,
                'latestAt' => null,
                'source' => 'NOT_FOUND',
            ];
        }

        $summaryMatched = 0;
        $detailFallbackChecked = 0;
        try {
            $summaryRows = DB::connection('adb')->table('dws_app_event_quality_daily')
                ->where('stat_date', $date)
                ->where('project_code', $projectCode)
                ->when($appIdentifier !== '', fn (Builder $query) => $query->where('app_identifier', $appIdentifier))
                ->whereIn('event_name', $requestedEvents)
                ->selectRaw('event_name')
                ->selectRaw('SUM(total_event_count) AS total_event_count')
                ->selectRaw('SUM(accepted_event_count) AS accepted_event_count')
                ->selectRaw('SUM(firebase_event_count) AS firebase_event_count')
                ->selectRaw('SUM(quarantine_count) AS quarantine_count')
                ->selectRaw('SUM(type_mismatch_count) AS type_mismatch_count')
                ->selectRaw('SUM(p0_field_total) AS p0_field_total')
                ->selectRaw('SUM(p0_field_present) AS p0_field_present')
                ->selectRaw('MAX(p0_completeness_rate) AS p0_completeness_rate')
                ->selectRaw('MAX(computed_at) AS computed_at')
                ->groupBy('event_name')
                ->get();

            foreach ($summaryRows as $row) {
                $eventName = $this->normalizeTrackingEventName((string) $row->event_name);
                if (!isset($eventsByName[$eventName])) {
                    continue;
                }
                $eventCount = (int) ($row->total_event_count ?? 0);
                $acceptedCount = (int) ($row->accepted_event_count ?? 0);
                $summaryMatched++;
                $p0Total = (int) ($row->p0_field_total ?? 0);
                $p0Present = (int) ($row->p0_field_present ?? 0);
                $eventsByName[$eventName] = array_merge($eventsByName[$eventName], [
                    'received' => $eventCount > 0 || $acceptedCount > 0,
                    'eventCount' => $eventCount,
                    'acceptedCount' => $acceptedCount,
                    'quarantineCount' => (int) ($row->quarantine_count ?? 0),
                    'typeMismatchCount' => (int) ($row->type_mismatch_count ?? 0),
                    'p0FieldTotal' => $p0Total,
                    'p0FieldPresent' => $p0Present,
                    'p0CompletenessRate' => $p0Total > 0 ? round($p0Present * 100 / $p0Total, 2) : ($row->p0_completeness_rate === null ? null : round((float) $row->p0_completeness_rate, 2)),
                    'latestAt' => $row->computed_at ? (string) $row->computed_at : null,
                    'source' => 'DWS_SUMMARY',
                ]);
            }
        } catch (Throwable $exception) {
            Log::warning('tracking event coverage summary query failed: ' . $exception->getMessage());
        }

        $missingEvents = array_values(array_filter($requestedEvents, fn ($eventName) => !$eventsByName[$eventName]['received']));
        if (!empty($missingEvents)) {
            try {
                $detailRows = DB::connection('adb')->table($this->eventTable())
                    ->where('event_date', $date)
                    ->where('project_code', $projectCode)
                    ->when($appIdentifier !== '', fn (Builder $query) => $query->where('app_identifier', $appIdentifier))
                    ->whereIn('event_name', $missingEvents)
                    ->selectRaw('event_name')
                    ->selectRaw('COUNT(*) AS event_count')
                    ->selectRaw("COUNT(DISTINCT NULLIF(my_user_id, '')) AS users")
                    ->selectRaw("SUM(CASE WHEN data_status = 'accepted' OR quality_status = 'valid' THEN 1 ELSE 0 END) AS accepted_count")
                    ->selectRaw("SUM(CASE WHEN data_status != 'accepted' OR quality_status != 'valid' THEN 1 ELSE 0 END) AS invalid_count")
                    ->selectRaw('MAX(event_time_utc) AS latest_at')
                    ->groupBy('event_name')
                    ->get();

                foreach ($detailRows as $row) {
                    $eventName = $this->normalizeTrackingEventName((string) $row->event_name);
                    if (!isset($eventsByName[$eventName])) {
                        continue;
                    }
                    $detailFallbackChecked++;
                    $eventCount = (int) ($row->event_count ?? 0);
                    $eventsByName[$eventName] = array_merge($eventsByName[$eventName], [
                        'received' => $eventCount > 0,
                        'eventCount' => $eventCount,
                        'acceptedCount' => (int) ($row->accepted_count ?? 0),
                        'users' => (int) ($row->users ?? 0),
                        'typeMismatchCount' => (int) ($row->invalid_count ?? 0),
                        'latestAt' => $row->latest_at ? (string) $row->latest_at : null,
                        'source' => $eventCount > 0 ? 'DWD_FALLBACK' : 'NOT_FOUND',
                    ]);
                }
            } catch (Throwable $exception) {
                Log::warning('tracking event coverage detail query failed: ' . $exception->getMessage());
            }
        }

        return [
            'projectCode' => $projectCode,
            'appIdentifier' => $appIdentifier,
            'date' => $date,
            'events' => array_values($eventsByName),
            'queryPlan' => [
                'summaryTable' => 'dws_app_event_quality_daily',
                'detailFallbackTable' => $this->eventTable(),
                'summaryMatched' => $summaryMatched,
                'detailFallbackChecked' => $detailFallbackChecked,
                'queriedAt' => Carbon::now(config('app.timezone', 'Asia/Shanghai'))->toDateTimeString(),
            ],
        ];
    }

    /**
     * Dispatch the shared query contract to the requested native analysis page.
     */
    public function query(array $params): array
    {
        if (!empty($params['projectCode'])) {
            $params['projectCode'] = $this->resolveProjectCode((string) $params['projectCode']);
        }

        $page = (string) ($params['page'] ?? 'overview');
        // The VPN workbench already caches its DWS summary internally; avoid
        // double-caching it under a second key.
        $skipCache = $page === 'workbench' && ($params['domain'] ?? 'ads') === 'vpn';
        if (in_array($page, $this->cacheableQueryPages(), true) && !$skipCache) {
            return $this->cacheAnalysisResult($page, $params, function () use ($page, $params): array {
                return $this->dispatchQuery($page, $params);
            });
        }

        return $this->dispatchQuery($page, $params);
    }

    /**
     * Pages whose result is deterministic for one filter snapshot and is safe to
     * cache. These previously re-scanned ADB DWD event detail on every request;
     * caching them removes the repeated full-table scans behind the dashboard.
     *
     * @return array<int, string>
     */
    private function cacheableQueryPages(): array
    {
        return ['overview', 'workbench', 'diagnosis', 'path', 'evidence'];
    }

    /**
     * @param array<string, mixed> $params
     * @return array<string, mixed>
     */
    private function dispatchQuery(string $page, array $params): array
    {
        return match ($page) {
            'overview' => $this->overview($params),
            'workbench' => $this->workbench($params),
            'diagnosis' => $this->diagnosis($params),
            'cohort' => $this->cohort($params),
            'path' => $this->path($params),
            'evidence' => $this->evidence($params),
            'issues' => $this->issues($params),
            'snapshot' => $this->snapshot(),
            default => throw new InvalidArgumentException('不支持的漏斗分析页面'),
        };
    }

    /**
     * Cache a full page result keyed on the normalized filter snapshot. Historical
     * dates (dateTo < today) are stable after the daily aggregate window and stay
     * warm for 12h; today refreshes every 2 minutes. Raw evidence detail keeps a
     * short TTL because late-arriving rows can still land.
     *
     * @param array<string, mixed> $params
     * @param callable(): array<string, mixed> $builder
     * @return array<string, mixed>
     */
    private function cacheAnalysisResult(string $namespace, array $params, callable $builder): array
    {
        return Cache::remember(
            $this->analysisPageCacheKey($namespace, $params),
            $this->analysisPageCacheSeconds($namespace, $params),
            $builder
        );
    }

    /**
     * @param array<string, mixed> $params
     */
    private function analysisPageCacheKey(string $namespace, array $params): string
    {
        return 'jkcl_funnel:page:' . $namespace . ':' . md5(json_encode(
            $this->sortForCacheKey($params),
            JSON_UNESCAPED_UNICODE
        ));
    }

    /**
     * @param array<string, mixed> $params
     */
    private function analysisPageCacheSeconds(string $page, array $params): int
    {
        if ($page === 'evidence') {
            return 300;
        }

        return $this->summaryWorkbenchCacheSeconds($params);
    }

    /**
     * Drop cached results for a filter snapshot so a --force warm run rebuilds
     * them from ADB instead of reusing stale entries.
     *
     * @param array<string, mixed> $params
     */
    private function forgetAnalysisPageCaches(array $params): void
    {
        foreach ($this->cacheableQueryPages() as $page) {
            Cache::forget($this->analysisPageCacheKey($page, array_replace($params, ['page' => $page])));
        }
        if (($params['page'] ?? 'workbench') === 'workbench' && ($params['domain'] ?? 'vpn') === 'vpn') {
            Cache::forget($this->vpnSummaryWorkbenchCacheKey($params));
        }
    }

    /**
     * Warm one operational workbench query using the same cache key as HTTP requests.
     *
     * This is used by the 05:00 scheduled job so operators open the VPN page
     * against cached DWS summaries instead of waiting for several ADB round trips.
     *
     * @param array<string, mixed> $params
     * @return array<string, mixed>
     */
    public function warmWorkbenchCache(array $params, bool $force = false): array
    {
        $query = array_filter($params, static fn ($value): bool => $value !== null && $value !== '');
        $query['page'] = (string) ($query['page'] ?? 'workbench');
        $query['domain'] = (string) ($query['domain'] ?? 'vpn');
        $query['unit'] = (string) ($query['unit'] ?? (($query['domain'] ?? 'vpn') === 'vpn' ? 'sessions' : 'users'));

        if (!empty($query['projectCode'])) {
            $query['projectCode'] = $this->resolveProjectCode((string) $query['projectCode']);
        }

        if ($force) {
            $this->forgetAnalysisPageCaches($query);
        }

        $startedAt = microtime(true);
        $data = $this->query($query);

        return [
            'projectCode' => $query['projectCode'] ?? null,
            'appIdentifier' => $query['appIdentifier'] ?? null,
            'platform' => $query['platform'] ?? null,
            'dateFrom' => $query['dateFrom'] ?? null,
            'dateTo' => $query['dateTo'] ?? null,
            'page' => $query['page'],
            'domain' => $query['domain'],
            'querySource' => $data['querySource'] ?? null,
            'funnelCount' => is_countable($data['funnel'] ?? null) ? count($data['funnel']) : 0,
            'metricCount' => is_countable($data['metrics'] ?? null) ? count($data['metrics']) : 0,
            'latestLoadedAt' => data_get($data, 'freshness.latestLoadedAt') ?? data_get($data, 'quality.latestLoadedAt'),
            'elapsedMs' => (int) round((microtime(true) - $startedAt) * 1000),
            'cacheTtlSeconds' => ($query['page'] ?? null) === 'workbench' && ($query['domain'] ?? null) === 'vpn'
                ? $this->summaryWorkbenchCacheSeconds($query)
                : null,
        ];
    }

    /** Generate an AI diagnosis document and a password-protected public share link. */
    public function generateAiAnalysis(array $payload, string $actorEmail, string $frontendBaseUrl): array
    {
        $context = is_array($payload['context'] ?? null) ? $payload['context'] : [];
        $projectCode = $this->normalizeShareString($context['projectCode'] ?? $payload['projectCode'] ?? null, 64);
        $domain = $this->normalizeShareString($context['domain'] ?? $payload['domain'] ?? null, 24);
        $unit = $this->normalizeShareString($context['unit'] ?? $payload['unit'] ?? null, 24);
        $title = sprintf(
            '%s%sAI诊断报告',
            $projectCode ? $projectCode . ' · ' : '',
            $domain === 'vpn' ? 'VPN功能' : ($domain === 'quality' ? '数据质量' : '广告漏斗')
        );

        $safePayload = $this->sanitizeAiAnalysisPayload($payload);
        $reportMarkdown = $this->callAiAnalysisModel($safePayload, $title);
        $shareId = 'air_' . Str::lower(Str::random(24));
        $password = $this->generateSharePassword();
        $now = Carbon::now();

        DB::table('jkcl_ai_report_shares')->insert([
            'share_id' => $shareId,
            'password_hash' => Hash::make($password),
            'project_code' => $projectCode,
            'domain' => $domain,
            'unit' => $unit,
            'title' => $title,
            'report_markdown' => $reportMarkdown,
            'report_meta' => json_encode([
                'context' => $context,
                'model' => (string) env('JKCL_FUNNEL_AI_MODEL', 'deepseek-chat'),
                'generatedAt' => $now->toDateTimeString(),
                'maxAccessCount' => 3,
            ], JSON_UNESCAPED_UNICODE),
            'max_access_count' => 3,
            'access_count' => 0,
            'status' => 'ACTIVE',
            'created_by_email' => $this->normalizeShareString($actorEmail, 191),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $shareUrl = $this->buildAiShareUrl($frontendBaseUrl, $shareId);
        $shareUrlWithPassword = $shareUrl . (str_contains($shareUrl, '?') ? '&' : '?') . 'password=' . rawurlencode($password);

        return [
            'title' => $title,
            'markdown' => $reportMarkdown,
            'shareId' => $shareId,
            'shareUrl' => $shareUrl,
            'shareUrlWithPassword' => $shareUrlWithPassword,
            'password' => $password,
            'maxAccessCount' => 3,
            'accessCount' => 0,
            'remainingAccessCount' => 3,
            'copyText' => "AI诊断报告分享链接：{$shareUrlWithPassword}\n访问密码：{$password}\n说明：无需系统登录，最多可成功打开 3 次，超过后需重新生成。",
        ];
    }

    /** Public metadata; does not consume access count. */
    public function sharedAiReportMeta(string $shareId): ?array
    {
        $row = DB::table('jkcl_ai_report_shares')->where('share_id', $shareId)->first();
        if (!$row) {
            return null;
        }

        $accessCount = (int) ($row->access_count ?? 0);
        $maxAccessCount = (int) ($row->max_access_count ?? 3);
        $expired = (string) ($row->status ?? '') !== 'ACTIVE' || $accessCount >= $maxAccessCount;

        return [
            'shareId' => (string) $row->share_id,
            'title' => (string) $row->title,
            'projectCode' => (string) ($row->project_code ?? ''),
            'domain' => (string) ($row->domain ?? ''),
            'unit' => (string) ($row->unit ?? ''),
            'status' => $expired ? 'EXPIRED' : (string) $row->status,
            'accessCount' => $accessCount,
            'maxAccessCount' => $maxAccessCount,
            'remainingAccessCount' => max(0, $maxAccessCount - $accessCount),
            'createdAt' => (string) ($row->created_at ?? ''),
            'lastAccessedAt' => (string) ($row->last_accessed_at ?? ''),
        ];
    }

    /** Verify the public share password and consume one successful open. */
    public function openSharedAiReport(string $shareId, string $password, ?string $ip = null, ?string $userAgent = null): array
    {
        if (trim($password) === '') {
            $this->logAiShareAccess($shareId, 'BAD_PASSWORD', $ip, $userAgent);
            throw new InvalidArgumentException('请输入报告访问密码');
        }

        return DB::transaction(function () use ($shareId, $password, $ip, $userAgent): array {
            $row = DB::table('jkcl_ai_report_shares')->where('share_id', $shareId)->lockForUpdate()->first();
            if (!$row) {
                $this->logAiShareAccess($shareId, 'NOT_FOUND', $ip, $userAgent);
                throw new InvalidArgumentException('分享链接不存在或已删除');
            }

            $accessCount = (int) ($row->access_count ?? 0);
            $maxAccessCount = (int) ($row->max_access_count ?? 3);
            if ((string) ($row->status ?? '') !== 'ACTIVE' || $accessCount >= $maxAccessCount) {
                if ((string) ($row->status ?? '') === 'ACTIVE') {
                    DB::table('jkcl_ai_report_shares')->where('id', $row->id)->update([
                        'status' => 'EXPIRED',
                        'updated_at' => Carbon::now(),
                    ]);
                }
                $this->logAiShareAccess($shareId, 'EXPIRED', $ip, $userAgent);
                throw new InvalidArgumentException('分享链接已达到 3 次打开上限，请重新生成');
            }

            if (!Hash::check($password, (string) $row->password_hash)) {
                $this->logAiShareAccess($shareId, 'BAD_PASSWORD', $ip, $userAgent);
                throw new InvalidArgumentException('访问密码不正确');
            }

            $now = Carbon::now();
            DB::table('jkcl_ai_report_shares')->where('id', $row->id)->update([
                'access_count' => $accessCount + 1,
                'status' => $accessCount + 1 >= $maxAccessCount ? 'EXPIRED' : 'ACTIVE',
                'last_accessed_at' => $now,
                'updated_at' => $now,
            ]);
            $this->logAiShareAccess($shareId, 'SUCCESS', $ip, $userAgent);

            return [
                'shareId' => (string) $row->share_id,
                'title' => (string) $row->title,
                'projectCode' => (string) ($row->project_code ?? ''),
                'domain' => (string) ($row->domain ?? ''),
                'unit' => (string) ($row->unit ?? ''),
                'markdown' => (string) $row->report_markdown,
                'accessCount' => $accessCount + 1,
                'maxAccessCount' => $maxAccessCount,
                'remainingAccessCount' => max(0, $maxAccessCount - $accessCount - 1),
                'createdAt' => (string) ($row->created_at ?? ''),
                'openedAt' => $now->toDateTimeString(),
            ];
        });
    }

    private function callAiAnalysisModel(array $payload, string $title): string
    {
        $token = trim((string) env('JKCL_FUNNEL_AI_TOKEN', ''));
        if ($token === '') {
            throw new InvalidArgumentException('AI token 未配置');
        }

        $baseUrl = rtrim((string) env('JKCL_FUNNEL_AI_BASE_URL', 'https://api.deepseek.com'), '/');
        $model = (string) env('JKCL_FUNNEL_AI_MODEL', 'deepseek-chat');
        $timeout = max(10, (int) env('JKCL_FUNNEL_AI_TIMEOUT_SECONDS', 60));
        $payloadJson = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        $response = Http::withToken($token)
            ->acceptJson()
            ->timeout($timeout)
            ->post($baseUrl . '/chat/completions', [
                'model' => $model,
                'temperature' => 0.2,
                'messages' => [
                    [
                        'role' => 'system',
                        'content' => '你是十年经验的广告变现和VPN增长产品经理。只根据用户提供的漏斗、页面、原因和数据质量摘要分析，输出中文 Markdown 报告。不要编造未提供的数据；缺数据时明确写“当前数据不足”。',
                    ],
                    [
                        'role' => 'user',
                        'content' => "报告标题：{$title}\n请输出：结论、核心证据、最大流失环节、可能原因排序、运营动作、技术动作、需要补查的数据。\n\n数据上下文JSON：\n{$payloadJson}",
                    ],
                ],
            ]);

        if (!$response->successful()) {
            throw new InvalidArgumentException('AI 接口调用失败：HTTP ' . $response->status());
        }

        $content = data_get($response->json(), 'choices.0.message.content');
        if (!is_string($content) || trim($content) === '') {
            throw new InvalidArgumentException('AI 接口未返回报告内容');
        }

        return trim($content);
    }

    private function sanitizeAiAnalysisPayload(array $payload): array
    {
        $allowed = [
            'context',
            'currentIssues',
            'metrics',
            'funnel',
            'transitions',
            'pagePathTop',
            'diagnosisReasons',
            'ask',
        ];
        $safe = array_intersect_key($payload, array_flip($allowed));
        $encoded = json_encode($safe, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (strlen((string) $encoded) > 60000) {
            $safe['pagePathTop'] = array_slice((array) ($safe['pagePathTop'] ?? []), 0, 8);
            $safe['diagnosisReasons'] = array_slice((array) ($safe['diagnosisReasons'] ?? []), 0, 8);
            $safe['metrics'] = array_slice((array) ($safe['metrics'] ?? []), 0, 8);
        }

        return $safe;
    }

    private function buildAiShareUrl(string $frontendBaseUrl, string $shareId): string
    {
        $base = rtrim($frontendBaseUrl, '/');
        if ($base === '') {
            $base = rtrim((string) env('JKCL_FUNNEL_FRONTEND_BASE_URL', 'https://analysis.geekforest.ai'), '/');
        }

        return $base . '/?sharedReport=1&sid=' . rawurlencode($shareId);
    }

    private function generateSharePassword(): string
    {
        return Str::upper(Str::random(4)) . '-' . Str::lower(Str::random(4));
    }

    private function normalizeShareString(mixed $value, int $maxLength): string
    {
        return Str::limit(trim((string) ($value ?? '')), $maxLength, '');
    }

    private function logAiShareAccess(string $shareId, string $result, ?string $ip, ?string $userAgent): void
    {
        try {
            DB::table('jkcl_ai_report_share_access_logs')->insert([
                'share_id' => Str::limit($shareId, 64, ''),
                'result' => Str::limit($result, 24, ''),
                'ip' => $ip ? Str::limit($ip, 64, '') : null,
                'user_agent' => $userAgent ? Str::limit($userAgent, 500, '') : null,
                'accessed_at' => Carbon::now(),
            ]);
        } catch (Throwable) {
            // Access logging should never block report viewing.
        }
    }

    /** Create a fixed, email-gated project analysis snapshot share. */
    public function createProjectReportShare(array $payload, string $actorEmail, string $frontendBaseUrl): array
    {
        $snapshot = is_array($payload['snapshot'] ?? null) ? $payload['snapshot'] : [];
        if (empty($snapshot)) {
            throw new InvalidArgumentException('当前页面还没有可分享的数据，请先完成查询');
        }

        $context = is_array($snapshot['context'] ?? null) ? $snapshot['context'] : [];
        $projectCode = $this->normalizeShareString($context['projectCode'] ?? $snapshot['projectCode'] ?? $payload['projectCode'] ?? null, 64);
        $appIdentifier = $this->normalizeShareString($context['appIdentifier'] ?? $snapshot['appIdentifier'] ?? null, 191);
        $module = $this->normalizeShareString($payload['module'] ?? $snapshot['module'] ?? null, 32);
        $page = $this->normalizeShareString($payload['page'] ?? $snapshot['page'] ?? null, 32);
        $domain = $this->normalizeShareString($snapshot['domain'] ?? $context['domain'] ?? null, 24);
        $unit = $this->normalizeShareString($snapshot['unit'] ?? $context['unit'] ?? null, 24);
        $title = $this->normalizeShareString(
            $payload['title'] ?? sprintf(
                '%s · %s项目报告',
                $projectCode ?: '全部项目',
                $domain === 'vpn' ? 'VPN功能漏斗' : '广告漏斗'
            ),
            191
        );
        $snapshot['aiDiagnosis'] = $this->generateProjectReportAiDiagnosis($snapshot, $title);
        $filters = [
            'projectCode' => $projectCode,
            'appIdentifier' => $appIdentifier,
            'module' => $module,
            'page' => $page,
            'domain' => $domain,
            'unit' => $unit,
            'range' => $context['range'] ?? $snapshot['range'] ?? null,
            'dateFrom' => $context['dateFrom'] ?? $snapshot['dates']['dateFrom'] ?? null,
            'dateTo' => $context['dateTo'] ?? $snapshot['dates']['dateTo'] ?? null,
            'platform' => $context['platform'] ?? $snapshot['platform'] ?? null,
            'country' => $context['country'] ?? $snapshot['country'] ?? null,
            'appVersion' => $context['appVersion'] ?? $snapshot['appVersion'] ?? null,
        ];

        $shareId = 'prs_' . Str::lower(Str::random(24));
        $now = Carbon::now();
        DB::table('jkcl_project_report_shares')->insert([
            'share_id' => $shareId,
            'title' => $title,
            'project_code' => $projectCode ?: null,
            'app_identifier' => $appIdentifier ?: null,
            'module' => $module ?: null,
            'page' => $page ?: null,
            'domain' => $domain ?: null,
            'unit' => $unit ?: null,
            'filters_json' => json_encode($filters, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'snapshot_json' => json_encode($this->sanitizeProjectReportSnapshot($snapshot), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'status' => 'ACTIVE',
            'risk_status' => 'NORMAL',
            'access_count' => 0,
            'created_by_email' => $this->normalizeShareString($actorEmail, 191),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $shareUrl = $this->buildProjectReportShareUrl($frontendBaseUrl, $shareId);

        return [
            'shareId' => $shareId,
            'title' => $title,
            'shareUrl' => $shareUrl,
            'status' => 'ACTIVE',
            'copyText' => "项目报告分享链接：{$shareUrl}\n查看方式：打开后输入公司邮箱即可查看固定快照。\n报告内容：包含当前页面全部查询结果、AI诊断、AI建议、核心图表和事件证据。\n安全说明：系统会记录访问邮箱、IP、设备/浏览器、网络与查看时间；异常访问会触发泄漏提醒。",
        ];
    }

    /** Public project-report metadata; does not expose report data. */
    public function projectReportShareMeta(string $shareId): ?array
    {
        $row = DB::table('jkcl_project_report_shares')->where('share_id', $shareId)->first();
        if (!$row) {
            return null;
        }

        return [
            'shareId' => (string) $row->share_id,
            'title' => (string) $row->title,
            'projectCode' => (string) ($row->project_code ?? ''),
            'appIdentifier' => (string) ($row->app_identifier ?? ''),
            'module' => (string) ($row->module ?? ''),
            'page' => (string) ($row->page ?? ''),
            'domain' => (string) ($row->domain ?? ''),
            'unit' => (string) ($row->unit ?? ''),
            'status' => (string) ($row->status ?? ''),
            'riskStatus' => (string) ($row->risk_status ?? 'NORMAL'),
            'accessCount' => (int) ($row->access_count ?? 0),
            'createdByEmail' => (string) ($row->created_by_email ?? ''),
            'createdAt' => (string) ($row->created_at ?? ''),
            'lastAccessedAt' => (string) ($row->last_accessed_at ?? ''),
            'requiresCompanyEmail' => true,
            'allowedEmailDomains' => $this->projectReportShareAllowedDomains(),
            'deviceNotice' => '浏览器无法稳定读取真实电脑型号；系统会记录浏览器可提供的平台、屏幕、语言、时区、网络类型、RTT、IP 和 User-Agent。',
        ];
    }

    /** Verify company email, log public access evidence, and return the fixed snapshot. */
    public function openProjectReportShare(string $shareId, string $viewerEmail, array $deviceInfo, ?string $ip = null, ?string $userAgent = null): array
    {
        $viewerEmail = Str::lower(trim($viewerEmail));
        $result = 'SUCCESS';
        if (!filter_var($viewerEmail, FILTER_VALIDATE_EMAIL) || !$this->isProjectReportAllowedEmail($viewerEmail)) {
            $result = 'BAD_EMAIL';
        }

        return DB::transaction(function () use ($shareId, $viewerEmail, $deviceInfo, $ip, $userAgent, $result): array {
            $row = DB::table('jkcl_project_report_shares')->where('share_id', $shareId)->lockForUpdate()->first();
            if (!$row) {
                $this->logProjectReportShareAccess($shareId, $viewerEmail, 'NOT_FOUND', ['link_not_found'], $deviceInfo, $ip, $userAgent);
                throw new InvalidArgumentException('分享链接不存在或已删除');
            }

            if ((string) ($row->status ?? '') !== 'ACTIVE') {
                $riskReasons = ['revoked_or_expired_access'];
                $this->logProjectReportShareAccess($shareId, $viewerEmail, 'REVOKED', $riskReasons, $deviceInfo, $ip, $userAgent);
                $this->createProjectShareAlert($row, 'REVOKED_ACCESS', 'HIGH', '已终止或失效的项目报告链接仍被访问', $riskReasons, $viewerEmail, $ip, $userAgent);
                throw new InvalidArgumentException('分享链接已终止，请联系分享人重新生成');
            }

            $riskReasons = $this->projectReportRiskReasons($row, $viewerEmail, $deviceInfo, $ip);
            if ($result === 'BAD_EMAIL') {
                $riskReasons[] = 'non_company_email';
                $this->logProjectReportShareAccess($shareId, $viewerEmail, 'BAD_EMAIL', $riskReasons, $deviceInfo, $ip, $userAgent);
                $this->createProjectShareAlert($row, 'BAD_EMAIL', 'HIGH', '非公司邮箱尝试访问项目报告分享链接', $riskReasons, $viewerEmail, $ip, $userAgent);
                throw new InvalidArgumentException('请使用公司邮箱查看报告');
            }

            $now = Carbon::now();
            DB::table('jkcl_project_report_shares')->where('id', $row->id)->update([
                'access_count' => (int) ($row->access_count ?? 0) + 1,
                'risk_status' => empty($riskReasons) ? (string) ($row->risk_status ?? 'NORMAL') : 'SUSPICIOUS',
                'last_accessed_at' => $now,
                'updated_at' => $now,
            ]);
            $this->logProjectReportShareAccess($shareId, $viewerEmail, 'SUCCESS', $riskReasons, $deviceInfo, $ip, $userAgent);
            $onlineViewers = $this->touchProjectReportShareViewer($shareId, $viewerEmail, $deviceInfo, $ip, $userAgent);
            if (!empty($riskReasons)) {
                $this->createProjectShareAlert($row, 'SUSPICIOUS_ACCESS', $this->projectReportRiskLevel($riskReasons), '项目报告分享链接出现异常访问特征', $riskReasons, $viewerEmail, $ip, $userAgent);
            }

            return [
                'shareId' => (string) $row->share_id,
                'title' => (string) $row->title,
                'projectCode' => (string) ($row->project_code ?? ''),
                'appIdentifier' => (string) ($row->app_identifier ?? ''),
                'module' => (string) ($row->module ?? ''),
                'page' => (string) ($row->page ?? ''),
                'domain' => (string) ($row->domain ?? ''),
                'unit' => (string) ($row->unit ?? ''),
                'filters' => json_decode((string) ($row->filters_json ?? '{}'), true) ?: [],
                'snapshot' => json_decode((string) $row->snapshot_json, true) ?: [],
                'viewerEmail' => $viewerEmail,
                'riskReasons' => array_values(array_unique($riskReasons)),
                'onlineViewers' => $onlineViewers,
                'accessCount' => (int) ($row->access_count ?? 0) + 1,
                'openedAt' => $now->toDateTimeString(),
            ];
        });
    }

    /** Update the online heartbeat and return viewers active in the last few minutes. */
    public function heartbeatProjectReportShare(string $shareId, string $viewerEmail, array $deviceInfo, ?string $ip = null, ?string $userAgent = null): array
    {
        $viewerEmail = Str::lower(trim($viewerEmail));
        if (!filter_var($viewerEmail, FILTER_VALIDATE_EMAIL) || !$this->isProjectReportAllowedEmail($viewerEmail)) {
            throw new InvalidArgumentException('请使用公司邮箱查看报告');
        }

        $row = DB::table('jkcl_project_report_shares')->where('share_id', $shareId)->first();
        if (!$row || (string) ($row->status ?? '') !== 'ACTIVE') {
            throw new InvalidArgumentException('分享链接已终止，请联系分享人重新生成');
        }

        return $this->touchProjectReportShareViewer($shareId, $viewerEmail, $deviceInfo, $ip, $userAgent);
    }

    private function touchProjectReportShareViewer(string $shareId, string $viewerEmail, array $deviceInfo, ?string $ip, ?string $userAgent): array
    {
        $now = Carbon::now();
        try {
            $identity = ['share_id' => Str::limit($shareId, 64, ''), 'viewer_email' => Str::limit(Str::lower($viewerEmail), 191, '')];
            $attributes = [
                'status' => 'ONLINE',
                'last_ip' => $ip ? Str::limit($ip, 64, '') : null,
                'last_user_agent' => $userAgent ? Str::limit($userAgent, 500, '') : null,
                'device_platform' => $this->normalizeShareString($deviceInfo['platform'] ?? null, 120) ?: null,
                'browser_language' => $this->normalizeShareString($deviceInfo['language'] ?? null, 64) ?: null,
                'timezone' => $this->normalizeShareString($deviceInfo['timezone'] ?? null, 80) ?: null,
                'screen_size' => $this->normalizeShareString($deviceInfo['screen'] ?? null, 64) ?: null,
                'network_effective_type' => $this->normalizeShareString(data_get($deviceInfo, 'connection.effectiveType'), 32) ?: null,
                'last_seen_at' => $now,
                'updated_at' => $now,
            ];
            $exists = DB::table('jkcl_project_report_share_viewers')->where($identity)->exists();
            if ($exists) {
                DB::table('jkcl_project_report_share_viewers')->where($identity)->update($attributes);
            } else {
                DB::table('jkcl_project_report_share_viewers')->insert($identity + $attributes + [
                    'first_seen_at' => $now,
                    'created_at' => $now,
                ]);
            }
        } catch (Throwable $exception) {
            Log::warning('jkcl project report viewer heartbeat failed', ['share_id' => $shareId, 'error' => $exception->getMessage()]);
        }

        return $this->projectReportOnlineViewers($shareId);
    }

    private function projectReportOnlineViewers(string $shareId): array
    {
        try {
            $threshold = Carbon::now()->subMinutes((int) env('JKCL_PROJECT_REPORT_ONLINE_WINDOW_MINUTES', 5));
            $rows = DB::table('jkcl_project_report_share_viewers')
                ->where('share_id', $shareId)
                ->where('last_seen_at', '>=', $threshold)
                ->orderByDesc('last_seen_at')
                ->get(['viewer_email', 'last_seen_at', 'device_platform', 'network_effective_type'])
                ->map(fn ($row) => [
                    'email' => (string) $row->viewer_email,
                    'lastSeenAt' => (string) $row->last_seen_at,
                    'devicePlatform' => (string) ($row->device_platform ?? ''),
                    'networkEffectiveType' => (string) ($row->network_effective_type ?? ''),
                ])->values()->all();

            return [
                'onlineCount' => count($rows),
                'windowMinutes' => (int) env('JKCL_PROJECT_REPORT_ONLINE_WINDOW_MINUTES', 5),
                'viewers' => $rows,
            ];
        } catch (Throwable) {
            return ['onlineCount' => 0, 'windowMinutes' => 5, 'viewers' => []];
        }
    }

    /** List share security alerts for the internal abnormal-alert menu. */
    public function projectReportShareAlerts(array $params = []): array
    {
        $page = max(1, (int) ($params['pageIndex'] ?? 1));
        $pageSize = min(100, max(10, (int) ($params['pageSize'] ?? 30)));
        $query = DB::table('jkcl_project_report_share_alerts as alert')
            ->leftJoin('jkcl_project_report_shares as share', 'share.share_id', '=', 'alert.share_id');
        if (!empty($params['projectCode'])) {
            $query->where('alert.project_code', $params['projectCode']);
        }
        if (!empty($params['status']) && $params['status'] !== 'ALL') {
            $query->where('alert.status', $params['status']);
        }

        $total = (clone $query)->count();
        $items = $query
            ->orderByRaw("CASE WHEN alert.status = 'OPEN' THEN 0 ELSE 1 END")
            ->orderByDesc('alert.created_at')
            ->forPage($page, $pageSize)
            ->get([
                'alert.id', 'alert.share_id', 'alert.project_code', 'alert.alert_type', 'alert.alert_level',
                'alert.message', 'alert.evidence_json', 'alert.status', 'alert.email_sent', 'alert.email_error',
                'alert.created_at', 'alert.resolved_at', 'alert.resolved_by_email',
                'share.title', 'share.created_by_email', 'share.status as share_status', 'share.risk_status',
            ])
            ->map(fn ($row) => [
                'id' => (int) $row->id,
                'shareId' => (string) $row->share_id,
                'projectCode' => (string) ($row->project_code ?? ''),
                'title' => (string) ($row->title ?? ''),
                'alertType' => (string) $row->alert_type,
                'alertLevel' => (string) $row->alert_level,
                'message' => (string) $row->message,
                'evidence' => json_decode((string) ($row->evidence_json ?? '[]'), true) ?: [],
                'status' => (string) $row->status,
                'shareStatus' => (string) ($row->share_status ?? ''),
                'riskStatus' => (string) ($row->risk_status ?? ''),
                'createdByEmail' => (string) ($row->created_by_email ?? ''),
                'emailSent' => (bool) $row->email_sent,
                'emailError' => (string) ($row->email_error ?? ''),
                'createdAt' => (string) $row->created_at,
                'resolvedAt' => (string) ($row->resolved_at ?? ''),
                'resolvedByEmail' => (string) ($row->resolved_by_email ?? ''),
            ])->values()->all();

        return compact('items', 'total', 'page', 'pageSize') + [
            'summary' => [
                'open' => DB::table('jkcl_project_report_share_alerts')->where('status', 'OPEN')->count(),
                'high' => DB::table('jkcl_project_report_share_alerts')->where('status', 'OPEN')->where('alert_level', 'HIGH')->count(),
            ],
        ];
    }

    public function revokeProjectReportShare(string $shareId, string $actorEmail): array
    {
        $now = Carbon::now();
        $updated = DB::table('jkcl_project_report_shares')->where('share_id', $shareId)->update([
            'status' => 'REVOKED',
            'revoked_at' => $now,
            'revoked_by_email' => $this->normalizeShareString($actorEmail, 191),
            'updated_at' => $now,
        ]);
        if ($updated < 1) {
            throw new InvalidArgumentException('分享链接不存在');
        }

        return ['shareId' => $shareId, 'status' => 'REVOKED', 'revokedAt' => $now->toDateTimeString()];
    }

    private function generateProjectReportAiDiagnosis(array $snapshot, string $title): array
    {
        $payload = $this->projectReportAiPayload($snapshot);
        try {
            return [
                'status' => 'SUCCESS',
                'source' => 'server_ai',
                'generatedAt' => Carbon::now()->toDateTimeString(),
                'markdown' => $this->callAiAnalysisModel($payload, $title),
            ];
        } catch (Throwable $exception) {
            Log::warning('jkcl project report ai diagnosis failed', ['error' => $exception->getMessage()]);

            return [
                'status' => 'FAILED',
                'source' => 'fallback_rules',
                'generatedAt' => Carbon::now()->toDateTimeString(),
                'error' => Str::limit($exception->getMessage(), 300, ''),
                'markdown' => $this->fallbackProjectReportDiagnosis($payload),
            ];
        }
    }

    private function projectReportAiPayload(array $snapshot): array
    {
        $dataPackage = is_array($snapshot['dataPackage'] ?? null) ? $snapshot['dataPackage'] : [];
        $metrics = [];
        $funnel = [];
        $pages = [];
        $diagnosisReasons = [];
        foreach ($dataPackage as $section) {
            if (!is_array($section)) {
                continue;
            }
            if (isset($section['metrics']) && is_array($section['metrics'])) {
                $metrics = array_merge($metrics, array_slice($section['metrics'], 0, 16));
            }
            if (isset($section['funnel']) && is_array($section['funnel'])) {
                $funnel = array_merge($funnel, array_slice($section['funnel'], 0, 16));
            }
            foreach (['pages', 'reasons', 'diagnosisReasons'] as $key) {
                if (isset($section[$key]) && is_array($section[$key])) {
                    if ($key === 'pages') {
                        $pages = array_merge($pages, array_slice($section[$key], 0, 20));
                    } else {
                        $diagnosisReasons = array_merge($diagnosisReasons, array_slice($section[$key], 0, 20));
                    }
                }
            }
            if (isset($section['pageFunnel']['pages']) && is_array($section['pageFunnel']['pages'])) {
                $pages = array_merge($pages, array_slice($section['pageFunnel']['pages'], 0, 20));
            }
            if (isset($section['adPageFunnel']['pages']) && is_array($section['adPageFunnel']['pages'])) {
                $pages = array_merge($pages, array_slice($section['adPageFunnel']['pages'], 0, 20));
            }
        }

        return [
            'context' => $snapshot['context'] ?? [],
            'currentIssues' => [
                'packageErrors' => $snapshot['packageErrors'] ?? [],
                'progressItems' => $snapshot['progressItems'] ?? [],
            ],
            'metrics' => array_slice($metrics, 0, 20),
            'funnel' => array_slice($funnel, 0, 20),
            'pagePathTop' => array_slice($pages, 0, 20),
            'diagnosisReasons' => array_slice($diagnosisReasons, 0, 20),
            'ask' => '请把这份项目页面快照整理成图文报告所需的诊断结论：先说问题在哪里，再给证据、原因排序、运营建议、技术建议、下一步补查。',
        ];
    }

    private function fallbackProjectReportDiagnosis(array $payload): string
    {
        $context = $payload['context'] ?? [];
        $funnel = is_array($payload['funnel'] ?? null) ? $payload['funnel'] : [];
        $metrics = is_array($payload['metrics'] ?? null) ? $payload['metrics'] : [];
        $pages = is_array($payload['pagePathTop'] ?? null) ? $payload['pagePathTop'] : [];
        $drop = null;
        for ($index = 1; $index < count($funnel); $index++) {
            $from = (float) ($funnel[$index - 1]['count'] ?? $funnel[$index - 1]['value'] ?? $funnel[$index - 1]['users'] ?? 0);
            $to = (float) ($funnel[$index]['count'] ?? $funnel[$index]['value'] ?? $funnel[$index]['users'] ?? 0);
            if ($from <= 0) {
                continue;
            }
            $lossRate = max(0, ($from - $to) / $from * 100);
            if ($drop === null || $lossRate > $drop['lossRate']) {
                $drop = [
                    'from' => (string) ($funnel[$index - 1]['name'] ?? $funnel[$index - 1]['stepName'] ?? $funnel[$index - 1]['label'] ?? '上一节点'),
                    'to' => (string) ($funnel[$index]['name'] ?? $funnel[$index]['stepName'] ?? $funnel[$index]['label'] ?? '下一节点'),
                    'lossRate' => $lossRate,
                ];
            }
        }

        return "## AI诊断摘要\n\n"
            . "- 项目：" . (string) ($context['projectCode'] ?? '—') . "\n"
            . "- 范围：" . (string) ($context['dateFrom'] ?? '—') . " 至 " . (string) ($context['dateTo'] ?? '—') . "\n"
            . "- 当前最大断点：" . ($drop ? "{$drop['from']} → {$drop['to']}，流失约 " . round($drop['lossRate'], 2) . '%' : '当前漏斗数据不足，无法自动判断') . "\n"
            . "- 已读取指标数：" . count($metrics) . "，页面证据数：" . count($pages) . "\n\n"
            . "## 建议\n\n"
            . "1. 先确认最大断点前后两个事件是否都有稳定上报，尤其是 session_id / request_id / vpn_session_id 是否能串起来。\n"
            . "2. 如果广告浏览者比例低，优先拆资格拦截原因、机会覆盖、请求成功、加载成功未展示、展示失败这几层。\n"
            . "3. 如果 VPN 功能漏斗低，优先拆按钮点击、权限通过、节点选择、阶段耗时、失败原因、协议回退和 IP 变化。\n"
            . "4. 页面路径为 0 时不要直接判断产品无访问，应先检查 screen_name 与 page × step 汇总是否回填。\n";
    }

    private function sanitizeProjectReportSnapshot(array $snapshot): array
    {
        $encoded = json_encode($snapshot, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (strlen((string) $encoded) <= 1500000) {
            return $snapshot;
        }

        $next = $snapshot;
        $dataPackage = is_array($next['dataPackage'] ?? null) ? $next['dataPackage'] : [];
        foreach ($dataPackage as $key => $section) {
            if (is_array($section) && isset($section['items']) && is_array($section['items'])) {
                $dataPackage[$key]['items'] = array_slice($section['items'], 0, 80);
                $dataPackage[$key]['truncatedForShare'] = true;
            }
            if (is_array($section) && isset($section['projects']) && is_array($section['projects'])) {
                $dataPackage[$key]['projects'] = array_slice($section['projects'], 0, 80);
                $dataPackage[$key]['truncatedForShare'] = true;
            }
        }
        $next['dataPackage'] = $dataPackage;
        $next['shareNotice'] = '报告快照过大，证据/项目明细已保留前80条；核心指标、漏斗、路径、诊断摘要保留。';

        return $next;
    }

    private function buildProjectReportShareUrl(string $frontendBaseUrl, string $shareId): string
    {
        $base = rtrim($frontendBaseUrl, '/');
        if ($base === '') {
            $base = rtrim((string) env('JKCL_FUNNEL_FRONTEND_BASE_URL', 'https://analysis.geekforest.ai'), '/');
        }

        return $base . '/?projectReportShare=1&sid=' . rawurlencode($shareId);
    }

    /** @return array<int, string> */
    private function projectReportShareAllowedDomains(): array
    {
        $raw = (string) env('JKCL_PROJECT_REPORT_SHARE_EMAIL_DOMAINS', 'geekforest.ai');
        return collect(explode(',', $raw))
            ->map(fn ($item) => Str::lower(trim($item)))
            ->filter()
            ->unique()
            ->values()
            ->all();
    }

    private function isProjectReportAllowedEmail(string $email): bool
    {
        $domain = Str::afterLast(Str::lower($email), '@');
        return in_array($domain, $this->projectReportShareAllowedDomains(), true);
    }

    /** @return array<int, string> */
    private function projectReportRiskReasons(object $share, string $viewerEmail, array $deviceInfo, ?string $ip): array
    {
        $reasons = [];
        $query = DB::table('jkcl_project_report_share_access_logs')
            ->where('share_id', $share->share_id)
            ->where('result', 'SUCCESS');
        $distinctEmails = (clone $query)->whereNotNull('viewer_email')->distinct()->pluck('viewer_email')->map(fn ($value) => Str::lower((string) $value))->all();
        if (!empty($distinctEmails) && !in_array($viewerEmail, $distinctEmails, true)) {
            $reasons[] = 'multiple_viewer_emails';
        }
        $distinctIps = (clone $query)->whereNotNull('ip')->distinct()->pluck('ip')->filter()->values()->all();
        if ($ip && count($distinctIps) >= 2 && !in_array($ip, $distinctIps, true)) {
            $reasons[] = 'multiple_access_ips';
        }
        $platform = $this->normalizeShareString($deviceInfo['platform'] ?? null, 120);
        $distinctPlatforms = (clone $query)->whereNotNull('device_platform')->distinct()->pluck('device_platform')->filter()->values()->all();
        if ($platform && count($distinctPlatforms) >= 2 && !in_array($platform, $distinctPlatforms, true)) {
            $reasons[] = 'multiple_device_platforms';
        }

        return array_values(array_unique($reasons));
    }

    private function projectReportRiskLevel(array $riskReasons): string
    {
        foreach ($riskReasons as $reason) {
            if (in_array($reason, ['non_company_email', 'revoked_or_expired_access', 'multiple_viewer_emails'], true)) {
                return 'HIGH';
            }
        }

        return empty($riskReasons) ? 'NORMAL' : 'WARN';
    }

    private function logProjectReportShareAccess(string $shareId, string $viewerEmail, string $result, array $riskReasons, array $deviceInfo, ?string $ip, ?string $userAgent): void
    {
        try {
            DB::table('jkcl_project_report_share_access_logs')->insert([
                'share_id' => Str::limit($shareId, 64, ''),
                'viewer_email' => $viewerEmail ? Str::limit(Str::lower($viewerEmail), 191, '') : null,
                'result' => Str::limit($result, 32, ''),
                'risk_level' => $this->projectReportRiskLevel($riskReasons),
                'risk_reasons' => json_encode(array_values(array_unique($riskReasons)), JSON_UNESCAPED_UNICODE),
                'ip' => $ip ? Str::limit($ip, 64, '') : null,
                'user_agent' => $userAgent ? Str::limit($userAgent, 500, '') : null,
                'device_platform' => $this->normalizeShareString($deviceInfo['platform'] ?? null, 120) ?: null,
                'browser_language' => $this->normalizeShareString($deviceInfo['language'] ?? null, 64) ?: null,
                'timezone' => $this->normalizeShareString($deviceInfo['timezone'] ?? null, 80) ?: null,
                'screen_size' => $this->normalizeShareString($deviceInfo['screen'] ?? null, 64) ?: null,
                'device_memory' => $this->normalizeShareString($deviceInfo['deviceMemory'] ?? null, 32) ?: null,
                'hardware_concurrency' => $this->normalizeShareString($deviceInfo['hardwareConcurrency'] ?? null, 32) ?: null,
                'network_effective_type' => $this->normalizeShareString(data_get($deviceInfo, 'connection.effectiveType'), 32) ?: null,
                'network_downlink' => $this->normalizeShareString(data_get($deviceInfo, 'connection.downlink'), 32) ?: null,
                'network_rtt' => $this->normalizeShareString(data_get($deviceInfo, 'connection.rtt'), 32) ?: null,
                'network_save_data' => data_get($deviceInfo, 'connection.saveData') === null ? null : (bool) data_get($deviceInfo, 'connection.saveData'),
                'accessed_at' => Carbon::now(),
            ]);
        } catch (Throwable $exception) {
            Log::warning('jkcl project report share access log failed', ['share_id' => $shareId, 'error' => $exception->getMessage()]);
        }
    }

    private function createProjectShareAlert(object $share, string $type, string $level, string $message, array $riskReasons, string $viewerEmail, ?string $ip, ?string $userAgent): void
    {
        try {
            $evidence = [
                'viewerEmail' => $viewerEmail,
                'ip' => $ip,
                'userAgent' => $userAgent,
                'riskReasons' => array_values(array_unique($riskReasons)),
                'accessedAt' => Carbon::now()->toDateTimeString(),
            ];
            $alertId = DB::table('jkcl_project_report_share_alerts')->insertGetId([
                'share_id' => (string) $share->share_id,
                'project_code' => (string) ($share->project_code ?? ''),
                'alert_type' => $type,
                'alert_level' => $level,
                'message' => $message,
                'evidence_json' => json_encode($evidence, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                'status' => 'OPEN',
                'email_sent' => false,
                'created_at' => Carbon::now(),
                'updated_at' => Carbon::now(),
            ]);

            $mailResult = $this->sendProjectShareLeakMail($share, $message, $evidence);
            DB::table('jkcl_project_report_share_alerts')->where('id', $alertId)->update([
                'email_sent' => $mailResult['sent'],
                'email_error' => $mailResult['error'],
                'updated_at' => Carbon::now(),
            ]);
            DB::table('jkcl_project_report_shares')->where('share_id', $share->share_id)->update([
                'risk_status' => 'SUSPICIOUS',
                'updated_at' => Carbon::now(),
            ]);
        } catch (Throwable $exception) {
            Log::warning('jkcl project report share alert failed', ['share_id' => $share->share_id ?? null, 'error' => $exception->getMessage()]);
        }
    }

    /** @return array{sent: bool, error: ?string} */
    private function sendProjectShareLeakMail(object $share, string $message, array $evidence): array
    {
        $subject = '可能泄漏请尽快终止链接';
        $creator = filter_var((string) ($share->created_by_email ?? ''), FILTER_VALIDATE_EMAIL) ? (string) $share->created_by_email : 'oliver.l@geekforest.ai';
        $cc = array_values(array_unique(array_filter(['oliver.l@geekforest.ai', 'mark@sappoc.com'], fn ($email) => $email !== $creator)));
        $body = "项目报告分享链接出现异常访问，请尽快核查并终止链接。\n\n"
            . "报告：{$share->title}\n"
            . "项目：{$share->project_code}\n"
            . "Share ID：{$share->share_id}\n"
            . "异常：{$message}\n"
            . '访问邮箱：' . ($evidence['viewerEmail'] ?? '') . "\n"
            . 'IP：' . ($evidence['ip'] ?? '') . "\n"
            . '时间：' . ($evidence['accessedAt'] ?? Carbon::now()->toDateTimeString()) . "\n"
            . '原因：' . implode(',', (array) ($evidence['riskReasons'] ?? [])) . "\n";

        try {
            Mail::raw($body, function ($mail) use ($creator, $cc, $subject): void {
                $mail->to($creator)->cc($cc)->subject($subject);
            });

            return ['sent' => true, 'error' => null];
        } catch (Throwable $exception) {
            Log::warning('jkcl project report share alert mail failed', ['share_id' => $share->share_id ?? null, 'error' => $exception->getMessage()]);
            return ['sent' => false, 'error' => Str::limit($exception->getMessage(), 1000, '')];
        }
    }

    /**
     * Return cross-project health, monetization coverage, and fulfillment metrics.
     */
    private function overview(array $params): array
    {
        $rows = $this->aggregateQuery($params)
            ->selectRaw('project_code, MAX(app_name) AS app_name, MAX(app_identifier) AS app_identifier')
            ->groupBy('project_code')
            ->orderBy('project_code')
            ->get();

        $projects = $rows->map(fn ($row) => $this->formatHealthRow($row))->values();
        // Re-aggregate the complete scope so cross-project UVs stay distinct and
        // every aggregate field is preserved instead of summing a partial DTO.
        $total = $this->aggregateQuery($params)->first() ?: $this->emptyAggregate();

        return [
            'context' => $this->context($params),
            'summary' => $this->formatSummary($total),
            'projects' => $projects,
            'funnel' => $this->funnelStages($total),
            'fulfillment' => $this->formatFulfillment($total),
            'freshness' => $this->freshness($params),
            'dataNotice' => '当前结果由 ADB 标准事件明细实时聚合；Firebase 尚未校准的数据标记为 realtime。',
        ];
    }

    /**
     * Return one project's stages, daily trend, screens, and data-quality status.
     */
    private function workbench(array $params): array
    {
        if (($params['domain'] ?? 'ads') === 'vpn') {
            $summaryWorkbench = $this->vpnSummaryWorkbench($params);
            if ($summaryWorkbench !== null) {
                return $summaryWorkbench;
            }
        }

        $aggregate = $this->aggregateQuery($params)->first();
        $aggregate = $aggregate ?: $this->emptyAggregate();
        $comparisonParams = $this->comparisonParams($params);
        $comparisonAggregate = $comparisonParams
            ? ($this->aggregateQuery($comparisonParams)->first() ?: $this->emptyAggregate())
            : null;
        $metrics = $this->coreMetrics($aggregate, $params);
        $comparisonMetrics = $comparisonAggregate
            ? $this->coreMetrics($comparisonAggregate, $comparisonParams)
            : [];
        $comparisonAvailable = $comparisonAggregate?->latest_event_at !== null;
        $vpnStageHealth = ($params['domain'] ?? 'ads') === 'vpn'
            ? $this->vpnStageHealth($params, $comparisonAvailable ? $comparisonParams : null)
            : [];
        $funnel = $this->contextStages($aggregate, $params);
        $metrics = $this->attachMetricComparison(
            $metrics,
            $comparisonMetrics,
            $comparisonAvailable
        );
        $daily = $this->aggregateBaseQuery($params)
            ->selectRaw('event_date')
            ->selectRaw($this->aggregateSelect())
            ->groupBy('event_date')
            ->orderBy('event_date')
            ->get()
            ->map(fn ($row) => ['date' => $row->event_date] + $this->formatSummary($row));
        $qualityGates = $this->qualityGates($params);
        $vpnSupplemental = ($params['domain'] ?? 'ads') === 'vpn'
            ? $this->vpnSupplementalPanels($params, $daily->all(), $qualityGates)
            : [];
        $adSupplemental = ($params['domain'] ?? 'ads') === 'ads'
            ? $this->adSupplementalPanels($aggregate, $daily->all(), $qualityGates)
            : [];
        $versionComparison = $this->versionComparisonFromDws($params);

        $screens = $this->baseQuery($params)
            ->whereNotNull('screen_name')
            ->where('screen_name', '!=', '')
            ->selectRaw('screen_name, COUNT(*) AS events, COUNT(DISTINCT my_user_id) AS users')
            ->groupBy('screen_name')
            ->orderByDesc('events')
            ->limit(20)
            ->get();
        $topReasons = $this->failureReasons($params);
        $reasonEvents = max(1, (int) $topReasons->sum('events'));

        return [
            'context' => $this->context($params),
            'summary' => $this->formatSummary($aggregate),
            'funnel' => $funnel,
            'funnelSummary' => $this->funnelSummary($funnel, $aggregate, $params),
            'comparisonFunnel' => $comparisonAvailable
                ? $this->contextStages($comparisonAggregate, $comparisonParams)
                : [],
            'metrics' => $metrics,
            'vpnStageHealth' => $vpnStageHealth,
            'fulfillment' => $this->formatFulfillment($aggregate),
            'dailyTrend' => $daily,
            'screens' => $screens,
            'quality' => $this->qualitySummary($params),
            'qualityGates' => $qualityGates,
            'vpnNetworkChanges' => $vpnSupplemental['networkChanges'] ?? [],
            'vpnProtocolNodeRanking' => $vpnSupplemental['protocolNodeRanking'] ?? [],
            'adNetworkFailureMatrix' => ($params['domain'] ?? 'ads') === 'vpn' ? $this->adNetworkFailureMatrix($params) : [],
            'vpnTrend' => $vpnSupplemental['trend'] ?? [],
            'adPrechecks' => $adSupplemental['prechecks'] ?? [],
            'adTrend' => $adSupplemental['trend'] ?? [],
            'technicalChecks' => $vpnSupplemental['technicalChecks'] ?? ($adSupplemental['technicalChecks'] ?? []),
            'versionComparison' => $versionComparison,
            'topReasons' => $topReasons->take(6)->map(fn ($row) => [
                'reason' => $row->reason,
                'events' => (int) $row->events,
                'users' => (int) $row->users,
                'share' => $this->rate((int) $row->events, $reasonEvents),
            ])->values()->all(),
            'comparison' => [
                'type' => $params['compareType'] ?? 'yesterday_same_period',
                'dateFrom' => $comparisonParams['dateFrom'] ?? null,
                'dateTo' => $comparisonParams['dateTo'] ?? null,
                'available' => $comparisonAvailable,
            ],
            'domainMetricCounts' => [
                'vpn' => 9,
                'adsUsers' => 11,
                'adsEvents' => 7,
                'quality' => 6,
            ],
            'freshness' => $this->freshness($params),
        ];
    }

    /**
     * Compare application versions from the daily funnel summary without
     * scanning DWD detail events. The largest-DAU version is only a suggested
     * baseline; the UI may select any returned version as the baseline.
     */
    private function versionComparisonFromDws(array $params): array
    {
        $domain = (string) ($params['domain'] ?? 'ads');
        $funnelCode = $domain === 'vpn' ? 'vpn_user_coverage' : 'ad_user_coverage';

        try {
            $query = DB::connection('adb')->table('dws_app_funnel_stage_daily')
                ->whereBetween('stat_date', [$params['dateFrom'], $params['dateTo']])
                ->where('funnel_code', $funnelCode)
                ->where('scope_type', 'users')
                ->whereNotNull('app_version')
                ->where('app_version', '!=', '');
            $this->applySummaryProjectFilters($query, $params);
            if (!empty($params['platform'])) {
                $query->where('platform', strtolower((string) $params['platform']));
            }
            if (!empty($params['country'])) {
                $query->where('country_code', (string) $params['country']);
            }

            $stageRows = $query
                ->selectRaw('app_version, build_number, step_code, SUM(subject_count) AS users')
                ->groupBy('app_version', 'build_number', 'step_code')
                ->get();

            $versions = [];
            foreach ($stageRows as $stage) {
                $version = trim((string) ($stage->app_version ?? ''));
                $build = trim((string) ($stage->build_number ?? ''));
                $key = $version . '|' . $build;
                if (!isset($versions[$key])) {
                    $versions[$key] = [
                        'appVersion' => $version,
                        'buildNumber' => $build !== '' ? $build : null,
                        'versionLabel' => $build !== '' ? "{$version} ({$build})" : $version,
                        'stages' => [],
                    ];
                }
                $versions[$key]['stages'][(string) $stage->step_code] = (int) ($stage->users ?? 0);
            }

            $rows = collect(array_values($versions))->map(function (array $version) use ($domain): array {
                $stage = $version['stages'];
                $dau = (int) ($stage['dau'] ?? 0);
                if ($domain === 'vpn') {
                    $attempt = (int) ($stage['connect_attempt'] ?? 0);
                    $success = (int) ($stage['connect_success'] ?? 0);
                    return $version + [
                        'dauUsers' => $dau,
                        'connectAttemptUsers' => $attempt,
                        'connectSuccessUsers' => $success,
                        'connectAttemptRate' => $this->rate($attempt, $dau),
                        'connectSuccessRate' => $this->rate($success, $attempt),
                    ];
                }

                $check = (int) ($stage['eligibility'] ?? 0);
                $eligible = (int) ($stage['eligible'] ?? 0);
                $opportunity = (int) ($stage['opportunity'] ?? 0);
                $request = (int) ($stage['request'] ?? 0);
                $impression = (int) ($stage['impression'] ?? 0);
                $paid = (int) ($stage['paid'] ?? 0);
                return $version + [
                    'dauUsers' => $dau,
                    'eligibilityCheckUsers' => $check,
                    'eligibleUsers' => $eligible,
                    'opportunityUsers' => $opportunity,
                    'requestUsers' => $request,
                    'impressionUsers' => $impression,
                    'paidUsers' => $paid,
                    'viewerRatio' => $this->rate($impression, $dau),
                    'eligibilityPassRate' => $this->rate($eligible, $check),
                    'opportunityCoverageRate' => $this->rate($opportunity, $eligible),
                    'requestCoverageRate' => $this->rate($request, $opportunity),
                    'impressionConversionRate' => $this->rate($impression, $request),
                ];
            })->sortByDesc('dauUsers')->values();

            return [
                'rows' => $rows->all(),
                'suggestedBaseline' => $rows->first()['versionLabel'] ?? null,
                'source' => 'dws_app_funnel_stage_daily',
                'scope' => 'users',
                'domain' => $domain,
                'notice' => '同项目、同日期、同平台和国家下按 app_version/build_number 对比；比例使用同版本分子分母。样本量过小的版本仅作观察。',
            ];
        } catch (Throwable $exception) {
            Log::warning('jkcl_version_comparison_dws_failed', ['message' => $exception->getMessage()]);
            return ['rows' => [], 'source' => 'dws_app_funnel_stage_daily', 'domain' => $domain];
        }
    }

    /**
     * Build the VPN workbench from DWS aggregate tables.
     *
     * VPN analysis used to scan DWD JSON events for every first-screen query.
     * The operational page only needs daily/session/phase aggregates, so this
     * path keeps DWD for evidence pages and avoids blocking the dashboard.
     */
    private function vpnSummaryWorkbench(array $params): ?array
    {
        $cacheKey = $this->vpnSummaryWorkbenchCacheKey($params);
        $cacheSeconds = $this->summaryWorkbenchCacheSeconds($params);

        return Cache::remember($cacheKey, $cacheSeconds, function () use ($params, $cacheSeconds): ?array {
            try {
            $aggregate = $this->withVpnSummaryStageCounts(
                $this->vpnSummaryAggregateQuery($params)->first() ?: $this->emptyAggregate(),
                $params
            );
            $comparisonParams = $this->comparisonParams($params);
            $comparisonAggregate = $comparisonParams
                ? $this->withVpnSummaryStageCounts(
                    $this->vpnSummaryAggregateQuery($comparisonParams)->first() ?: $this->emptyAggregate(),
                    $comparisonParams
                )
                : null;
            $comparisonAvailable = $comparisonAggregate?->latest_event_at !== null;
            $metrics = $this->attachMetricComparison(
                $this->coreMetrics($aggregate, $params),
                $comparisonAggregate ? $this->coreMetrics($comparisonAggregate, $comparisonParams) : [],
                $comparisonAvailable
            );
            $daily = $params['dateFrom'] === $params['dateTo']
                ? collect([['date' => $params['dateFrom']] + $this->formatSummary($aggregate)])
                : $this->vpnSummaryDailyTrend($params);
            $quality = $this->summaryQualityFromDws($params);
            $qualityGates = $this->summaryQualityGatesFromQuality($quality);
            $vpnSupplemental = $this->summaryVpnSupplementalPanels($aggregate, $daily->all(), $qualityGates);
            $funnel = $this->contextStages($aggregate, $params);
            $topReasons = $this->summaryVpnFailureReasons($params);
            $reasonEvents = max(1, (int) $topReasons->sum('events'));

            return [
                'context' => $this->context($params),
                'summary' => $this->formatSummary($aggregate),
                'vpnConnectButtonClickUsers' => $aggregate->vpn_connect_button_click_users ?? null,
                'vpnPermissionGrantedUsers' => $aggregate->vpn_permission_available_users ?? null,
                'vpnPermissionAttemptCount' => (int) ($aggregate->vpn_permission_attempt_count ?? 0),
                'vpnPermissionSuccessCount' => (int) ($aggregate->vpn_permission_success_count ?? 0),
                'vpnNodeSelectedUsers' => $aggregate->vpn_node_selected_users ?? null,
                'funnel' => $funnel,
                'funnelSummary' => $this->funnelSummary($funnel, $aggregate, $params),
                'comparisonFunnel' => $comparisonAvailable
                    ? $this->contextStages($comparisonAggregate, $comparisonParams)
                    : [],
                'metrics' => $metrics,
                'vpnStageHealth' => $this->summaryVpnStageHealth($params, $comparisonAvailable ? $comparisonParams : null),
                'fulfillment' => $this->formatFulfillment($aggregate),
                'dailyTrend' => $daily,
                'screens' => $this->summaryScreens($params),
                'quality' => $quality,
                'qualityGates' => $qualityGates,
                'vpnNetworkChanges' => $vpnSupplemental['networkChanges'] ?? [],
                'vpnProtocolNodeRanking' => $vpnSupplemental['protocolNodeRanking'] ?? [],
                'adNetworkFailureMatrix' => $this->adNetworkFailureMatrix($params),
                'vpnTrend' => $vpnSupplemental['trend'] ?? [],
                'technicalChecks' => $vpnSupplemental['technicalChecks'] ?? [],
                'versionComparison' => $this->versionComparisonFromDws($params),
                'topReasons' => $topReasons->take(6)->map(fn ($row) => [
                    'reason' => $row->reason,
                    'events' => (int) $row->events,
                    'users' => (int) $row->users,
                    'share' => $this->rate((int) $row->events, $reasonEvents),
                ])->values()->all(),
                'comparison' => [
                    'type' => $params['compareType'] ?? 'yesterday_same_period',
                    'dateFrom' => $comparisonParams['dateFrom'] ?? null,
                    'dateTo' => $comparisonParams['dateTo'] ?? null,
                    'available' => $comparisonAvailable,
                ],
                'domainMetricCounts' => [
                    'vpn' => 9,
                    'adsUsers' => 11,
                    'adsEvents' => 7,
                    'quality' => 6,
                ],
                'freshness' => $this->summaryFreshnessFromAggregate($aggregate),
                'querySource' => 'dws_vpn_summary',
                'cacheTtlSeconds' => $cacheSeconds,
                'dataNotice' => 'VPN 页面已优先读取 dws_vpn_connection_quality_daily、dws_app_funnel_stage_daily、dws_screen_path_daily 和 dws_app_event_quality_daily 汇总表；DWD 明细仅在证据/深度诊断页按需使用。',
            ];
            } catch (Throwable $exception) {
            Log::warning('jkcl_vpn_summary_workbench_failed', [
                'message' => $exception->getMessage(),
                'projectCode' => $params['projectCode'] ?? null,
                'dateFrom' => $params['dateFrom'] ?? null,
                'dateTo' => $params['dateTo'] ?? null,
            ]);

            return null;
            }
        });
    }

    /**
     * Historical DWS partitions are stable after the 05:00 aggregate window, so
     * keep them warm for the workday. Today still stays short because data is
     * continuously refreshed by Firebase/API sync jobs.
     */
    private function summaryWorkbenchCacheSeconds(array $params): int
    {
        $timezone = (string) ($params['timezone'] ?? config('app.timezone', 'Asia/Shanghai'));
        try {
            $today = Carbon::now($timezone)->toDateString();
            $dateTo = Carbon::parse((string) ($params['dateTo'] ?? $today), $timezone)->toDateString();
        } catch (Throwable) {
            return 120;
        }

        return $dateTo < $today ? 43200 : 120;
    }

    private function vpnSummaryWorkbenchCacheKey(array $params): string
    {
        return 'jkcl_funnel:vpn_summary_workbench:' . md5(json_encode(
            $this->sortForCacheKey($params),
            JSON_UNESCAPED_UNICODE
        ));
    }

    /**
     * Sort nested arrays so scheduled prewarm and HTTP requests share one cache
     * key even if PHP receives request fields in a different insertion order.
     *
     * @param mixed $value
     * @return mixed
     */
    private function sortForCacheKey(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        foreach ($value as $key => $item) {
            $value[$key] = $this->sortForCacheKey($item);
        }
        ksort($value);

        return $value;
    }

    /**
     * Compare any two funnel steps and show related controlled failure reasons.
     */
    private function diagnosis(array $params): array
    {
        if (($params['domain'] ?? 'ads') === 'quality') {
            $params['domain'] = 'ads';
            $params['unit'] = 'users';
        }
        $aggregate = $this->aggregateQuery($params)->first() ?: $this->emptyAggregate();
        $stages = array_values(array_filter(
            $this->contextStages($aggregate, $params),
            fn (array $stage): bool => ($stage['available'] ?? true) !== false
        ));
        $defaultStartIndex = min(2, max(0, count($stages) - 2));
        $defaultEndIndex = min($defaultStartIndex + 1, max(0, count($stages) - 1));
        $startCode = (string) ($params['startStep'] ?? ($stages[$defaultStartIndex]['code'] ?? 'eligible'));
        $endCode = (string) ($params['endStep'] ?? ($stages[$defaultEndIndex]['code'] ?? 'opportunity'));
        $startIndex = array_search($startCode, array_column($stages, 'code'), true);
        $endIndex = array_search($endCode, array_column($stages, 'code'), true);
        if ($startIndex === false || $endIndex === false || $endIndex <= $startIndex) {
            $startIndex = $defaultStartIndex;
            $endIndex = $defaultEndIndex;
            $startCode = (string) ($stages[$startIndex]['code'] ?? 'eligible');
            $endCode = (string) ($stages[$endIndex]['code'] ?? 'opportunity');
        }

        $chain = $this->diagnosisChain($params, $startCode, $endCode);
        $start = array_replace($stages[$startIndex], [
            'count' => $chain['startCount'],
            'rawCount' => $chain['startCount'],
        ]);
        $end = array_replace($stages[$endIndex], [
            'count' => $chain['convertedStartCount'],
            'rawCount' => $chain['rawEndCount'],
            'linkedCount' => $chain['linkedEndCount'],
        ]);
        $lost = max(0, $chain['startCount'] - $chain['convertedStartCount']);
        $reasons = $this->diagnosisReasons($params, $startCode, $endCode, $lost);
        $classified = (int) $reasons->where('reason', '!=', 'unknown')->sum('events');
        $unknown = (int) ($reasons->firstWhere('reason', 'unknown')->events ?? 0);
        $reasonDenominator = max($lost, 1);
        $selectedDefinitions = array_slice($stages, $startIndex, $endIndex - $startIndex + 1);
        $relationType = collect($selectedDefinitions)->contains(fn (array $step): bool => (bool) ($step['isBranch'] ?? false))
            ? 'coverage'
            : 'conversion';

        $reasonCoverageRate = $lost === 0 ? 100.0 : $this->rate($classified, $reasonDenominator);
        $unknownRate = $lost === 0 ? 0.0 : $this->rate($unknown, $reasonDenominator);
        $chainLinkRate = $chain['rawEndCount'] === 0
            ? 100.0
            : $this->rate($chain['linkedEndCount'], $chain['rawEndCount']);
        $confidence = match (true) {
            $reasonCoverageRate >= 99 && $chainLinkRate >= 95 && $unknownRate < 1 => 'high',
            $reasonCoverageRate >= 80 && $chainLinkRate >= 80 && $unknownRate < 20 => 'medium',
            default => 'low',
        };
        $confidenceScore = (int) round(
            ($reasonCoverageRate + $chainLinkRate + max(0, 100 - $unknownRate)) / 3
        );

        return [
            'context' => $this->context($params),
            'steps' => $stages,
            'selection' => [
                'start' => $start,
                'end' => $end,
                'conversionRate' => $this->rate($chain['convertedStartCount'], $chain['startCount']),
                'lostCount' => $lost,
                'relationType' => $relationType,
            ],
            'reasons' => $reasons,
            'quality' => $this->qualitySummary($params),
            'reasonCoverageRate' => $reasonCoverageRate,
            'unknownRate' => $unknownRate,
            'chainLinkRate' => $chainLinkRate,
            'confidence' => $confidence,
            'confidenceScore' => $confidenceScore,
            'confidenceBasis' => '高：原因覆盖率 >= 99%、事件链可关联率 >= 95%、Unknown 率 < 1%；中：三项分别达到 80%、80%、< 20%',
            'estimatedRevenueImpact' => [
                'value' => null,
                'currency' => 'USD',
                'period' => 'selected_range',
                'isModelEstimate' => false,
                'available' => false,
                'reason' => 'V1.7 未定义从漏斗流失量推算收入影响的模型',
            ],
        ];
    }

    /**
     * Count only subjects that reach the selected end step after the start step.
     */
    private function diagnosisChain(array $params, string $startCode, string $endCode): array
    {
        if (($params['domain'] ?? 'ads') === 'ads' && ($params['unit'] ?? 'users') === 'events') {
            return $this->diagnosisEventChain($params, $startCode, $endCode);
        }

        $start = $this->diagnosisUserStageQuery($params, $startCode);
        $end = $this->diagnosisUserStageQuery($params, $endCode);
        $endEvents = $this->diagnosisUserStageEventsQuery($params, $endCode);
        $startCount = (int) DB::connection('adb')->query()->fromSub(clone $start, 'stage_start')->count();
        $rawEndCount = (int) DB::connection('adb')->query()->fromSub(clone $end, 'stage_end')->count();
        $linked = DB::connection('adb')->query()
            ->fromSub(clone $start, 'stage_start')
            ->joinSub($endEvents, 'stage_end', function ($join): void {
                $join->on('stage_end.project_code', '=', 'stage_start.project_code')
                    ->on('stage_end.app_identifier', '=', 'stage_start.app_identifier')
                    ->on('stage_end.platform', '=', 'stage_start.platform')
                    ->on('stage_end.subject_id', '=', 'stage_start.subject_id')
                    ->whereColumn('stage_end.stage_at', '>=', 'stage_start.stage_at');
            });
        $convertedStarts = (clone $linked)
            ->select(['stage_start.project_code', 'stage_start.app_identifier', 'stage_start.platform', 'stage_start.subject_id'])
            ->groupBy('stage_start.project_code', 'stage_start.app_identifier', 'stage_start.platform', 'stage_start.subject_id');
        $linkedEnds = (clone $linked)
            ->select(['stage_end.project_code', 'stage_end.app_identifier', 'stage_end.platform', 'stage_end.subject_id'])
            ->groupBy('stage_end.project_code', 'stage_end.app_identifier', 'stage_end.platform', 'stage_end.subject_id');
        $convertedStartCount = (int) DB::connection('adb')->query()->fromSub($convertedStarts, 'converted_start')->count();
        $linkedEndCount = (int) DB::connection('adb')->query()->fromSub($linkedEnds, 'linked_end')->count();

        return compact('startCount', 'rawEndCount', 'convertedStartCount', 'linkedEndCount');
    }

    /**
     * Build one row per project and user for a selected UV funnel stage.
     */
    private function diagnosisUserStageQuery(array $params, string $code, ?string $dimension = null): Builder
    {
        $events = $this->diagnosisUserStageEventsQuery($params, $code, $dimension);
        $dimensionSelect = $dimension
            ? ", COALESCE(NULLIF(stage_event.dimension_value, ''), '未知') AS dimension_value"
            : '';
        $dimensionGroup = $dimension ? ['stage_event.dimension_value'] : [];

        return DB::connection('adb')->query()
            ->fromSub($events, 'stage_event')
            ->selectRaw("stage_event.project_code, stage_event.app_identifier, stage_event.platform, stage_event.subject_id, MIN(stage_event.stage_at) AS stage_at{$dimensionSelect}")
            ->groupBy(array_merge(
                ['stage_event.project_code', 'stage_event.app_identifier', 'stage_event.platform', 'stage_event.subject_id'],
                $dimensionGroup
            ));
    }

    /**
     * Keep every matching user-stage event so a valid event after the start is
     * not hidden by an earlier event from the same user.
     */
    private function diagnosisUserStageEventsQuery(array $params, string $code, ?string $dimension = null): Builder
    {
        $dimensionSelect = $dimension ? ', stage_event.' . $dimension . ' AS dimension_value' : '';

        if (in_array($code, ['post_connect_opportunity', 'post_connect_impression'], true)) {
            $contextParams = array_replace($params, [
                'dateFrom' => Carbon::parse($params['dateFrom'])->subDay()->toDateString(),
                'eventModule' => null,
            ]);
            $success = $this->baseQuery($contextParams)
                ->where('event_name', 'vpn_connection_result')
                ->whereRaw("LOWER(COALESCE(result_status, '')) = 'success'")
                ->whereNotNull('my_user_id')
                ->where('my_user_id', '!=', '')
                ->whereNotNull('session_id')
                ->where('session_id', '!=', '')
                ->selectRaw('project_code, app_identifier, my_user_id, session_id, MIN(event_time_utc) AS success_at')
                ->groupBy('project_code', 'app_identifier', 'my_user_id', 'session_id');
            $eventName = $code === 'post_connect_opportunity' ? 'ad_opportunity' : 'ad_impression';
            $events = $this->baseQuery(array_replace($params, ['eventModule' => null]))
                ->where('event_name', $eventName)
                ->whereNotNull('my_user_id')
                ->where('my_user_id', '!=', '')
                ->whereNotNull('session_id')
                ->where('session_id', '!=', '')
                ->select(array_merge(
                    ['project_code', 'app_identifier', 'platform', 'my_user_id', 'session_id', 'event_time_utc'],
                    $dimension ? [$dimension] : []
                ));

            return DB::connection('adb')->query()
                ->fromSub($events, 'stage_event')
                ->joinSub($success, 'vpn_success', function ($join): void {
                    $join->on('vpn_success.project_code', '=', 'stage_event.project_code')
                        ->on('vpn_success.app_identifier', '=', 'stage_event.app_identifier')
                        ->on('vpn_success.my_user_id', '=', 'stage_event.my_user_id')
                        ->on('vpn_success.session_id', '=', 'stage_event.session_id')
                        ->whereColumn('stage_event.event_time_utc', '>=', 'vpn_success.success_at');
                })
                ->selectRaw("stage_event.project_code, stage_event.app_identifier, stage_event.platform, stage_event.my_user_id AS subject_id, stage_event.event_time_utc AS stage_at{$dimensionSelect}");
        }

        $query = $this->baseQuery($params)
            ->whereNotNull('my_user_id')
            ->where('my_user_id', '!=', '');
        $this->applyDiagnosisStageCondition($query, $code);

        $dimensionSelect = $dimension ? ', ' . $dimension . ' AS dimension_value' : '';

        return $query->selectRaw("project_code, app_identifier, platform, my_user_id AS subject_id, event_time_utc AS stage_at{$dimensionSelect}");
    }

    /**
     * Count event-chain conversions by propagated opportunity/request/instance IDs.
     */
    private function diagnosisEventChain(array $params, string $startCode, string $endCode): array
    {
        $start = $this->diagnosisResolvedEventQuery($params, $startCode);
        $end = $this->diagnosisResolvedEventQuery($params, $endCode);
        $startCount = (int) DB::connection('adb')->query()->fromSub(clone $start, 'stage_start')->count();
        $rawEndCount = (int) DB::connection('adb')->query()->fromSub(clone $end, 'stage_end')->count();
        $linked = DB::connection('adb')->query()
            ->fromSub(clone $start, 'stage_start')
            ->joinSub(clone $end, 'stage_end', function ($join): void {
                $join->on('stage_end.project_code', '=', 'stage_start.project_code')
                    ->on('stage_end.app_identifier', '=', 'stage_start.app_identifier')
                    ->on('stage_end.platform', '=', 'stage_start.platform')
                    ->whereColumn('stage_end.stage_at', '>=', 'stage_start.stage_at')
                    ->whereRaw("((stage_start.opportunity_key IS NOT NULL AND stage_start.opportunity_key = stage_end.opportunity_key) OR (stage_start.request_key IS NOT NULL AND stage_start.request_key = stage_end.request_key) OR (stage_start.instance_key IS NOT NULL AND stage_start.instance_key = stage_end.instance_key))");
            });
        $convertedStartCount = (int) (clone $linked)
            ->selectRaw('COUNT(DISTINCT stage_start.event_id) AS aggregate')
            ->value('aggregate');
        $linkedEndCount = (int) (clone $linked)
            ->selectRaw('COUNT(DISTINCT stage_end.event_id) AS aggregate')
            ->value('aggregate');

        return compact('startCount', 'rawEndCount', 'convertedStartCount', 'linkedEndCount');
    }

    /**
     * Resolve all propagated ad-chain identifiers for one event funnel stage.
     */
    private function diagnosisResolvedEventQuery(array $params, string $code, ?string $dimension = null): Builder
    {
        $requestMap = $this->baseQuery($params)
            ->where('event_name', 'ad_request')
            ->whereNotNull('request_id')
            ->where('request_id', '!=', '')
            ->selectRaw('project_code, app_identifier, platform, request_id, MAX(NULLIF(opportunity_id, \'\')) AS opportunity_id')
            ->groupBy('project_code', 'app_identifier', 'platform', 'request_id');
        $instanceRows = $this->baseQuery($params)
            ->whereNotNull('ad_instance_id')
            ->where('ad_instance_id', '!=', '')
            ->select(['project_code', 'app_identifier', 'platform', 'ad_instance_id', 'request_id', 'opportunity_id']);
        $instanceMap = DB::connection('adb')->query()
            ->fromSub($instanceRows, 'instance_event')
            ->leftJoinSub(clone $requestMap, 'instance_request', function ($join): void {
                $join->on('instance_request.project_code', '=', 'instance_event.project_code')
                    ->on('instance_request.app_identifier', '=', 'instance_event.app_identifier')
                    ->on('instance_request.platform', '=', 'instance_event.platform')
                    ->on('instance_request.request_id', '=', 'instance_event.request_id');
            })
            ->selectRaw("instance_event.project_code, instance_event.app_identifier, instance_event.platform, instance_event.ad_instance_id, MAX(NULLIF(instance_event.request_id, '')) AS request_id, MAX(COALESCE(NULLIF(instance_event.opportunity_id, ''), instance_request.opportunity_id)) AS opportunity_id")
            ->groupBy('instance_event.project_code', 'instance_event.app_identifier', 'instance_event.platform', 'instance_event.ad_instance_id');
        $events = $this->baseQuery($params);
        $this->applyDiagnosisStageCondition($events, $code);
        $events->select(array_merge([
            'event_id', 'project_code', 'app_identifier', 'platform', 'event_time_utc', 'opportunity_id', 'request_id', 'ad_instance_id',
        ], $dimension ? [$dimension] : []));
        $dimensionSelect = $dimension ? ', stage_event.' . $dimension . ' AS dimension_value' : '';

        return DB::connection('adb')->query()
            ->fromSub($events, 'stage_event')
            ->leftJoinSub(clone $requestMap, 'request_map', function ($join): void {
                $join->on('request_map.project_code', '=', 'stage_event.project_code')
                    ->on('request_map.app_identifier', '=', 'stage_event.app_identifier')
                    ->on('request_map.platform', '=', 'stage_event.platform')
                    ->on('request_map.request_id', '=', 'stage_event.request_id');
            })
            ->leftJoinSub($instanceMap, 'instance_map', function ($join): void {
                $join->on('instance_map.project_code', '=', 'stage_event.project_code')
                    ->on('instance_map.app_identifier', '=', 'stage_event.app_identifier')
                    ->on('instance_map.platform', '=', 'stage_event.platform')
                    ->on('instance_map.ad_instance_id', '=', 'stage_event.ad_instance_id');
            })
            ->selectRaw("stage_event.event_id, stage_event.project_code, stage_event.app_identifier, stage_event.platform, stage_event.event_time_utc AS stage_at, COALESCE(NULLIF(stage_event.opportunity_id, ''), request_map.opportunity_id, instance_map.opportunity_id) AS opportunity_key, COALESCE(NULLIF(stage_event.request_id, ''), instance_map.request_id) AS request_key, NULLIF(stage_event.ad_instance_id, '') AS instance_key{$dimensionSelect}");
    }

    /** Apply the exact event predicate represented by one diagnosis step code. */
    private function applyDiagnosisStageCondition(Builder $query, string $code): void
    {
        match ($code) {
            'dau' => $query->where('event_name', 'app_foreground'),
            'eligibility' => $query->where('event_name', 'ad_eligibility_check'),
            'eligible' => $query->where('event_name', 'ad_eligibility_check')->where('eligible', true),
            'opportunity' => $query->where('event_name', 'ad_opportunity'),
            'request' => $query->where('event_name', 'ad_request'),
            'cache_hit' => $query->where('event_name', 'ad_cache_hit'),
            'realtime_request' => $query->where('event_name', 'ad_request')->whereRaw('COALESCE(is_preload, 0) = 0'),
            'request_accepted' => $query->whereIn('event_name', ['ad_request_accepted', 'request_accepted_derived']),
            'load_success' => $query->where('event_name', 'ad_load_success'),
            'ad_ready' => $query->where('event_name', 'ad_ready'),
            'show_attempt' => $query->where('event_name', 'ad_show_attempt'),
            'impression' => $query->where('event_name', 'ad_impression'),
            'paid' => $query->where('event_name', 'ad_paid_event'),
            'connect_attempt' => $query->where('event_name', 'vpn_connection_start'),
            'connect_success' => $query->where('event_name', 'vpn_connection_result')
                ->whereRaw("LOWER(COALESCE(result_status, '')) = 'success'"),
            default => $query->where('event_name', $this->stepEvent($code)),
        };
    }

    /**
     * Attribute only unconverted UV subjects; event chains stay unknown unless an ID-linked reason exists.
     */
    private function diagnosisReasons(array $params, string $startCode, string $endCode, int $lostCount)
    {
        if ($lostCount === 0) {
            return collect();
        }
        if (($params['domain'] ?? 'ads') === 'ads' && ($params['unit'] ?? 'users') === 'events') {
            return collect([(object) ['reason' => 'unknown', 'events' => $lostCount, 'users' => $lostCount]]);
        }

        $start = $this->diagnosisUserStageQuery($params, $startCode);
        $end = $this->diagnosisUserStageEventsQuery($params, $endCode);
        $lost = DB::connection('adb')->query()
            ->fromSub($start, 'stage_start')
            ->leftJoinSub($end, 'stage_end', function ($join): void {
                $join->on('stage_end.project_code', '=', 'stage_start.project_code')
                    ->on('stage_end.app_identifier', '=', 'stage_start.app_identifier')
                    ->on('stage_end.platform', '=', 'stage_start.platform')
                    ->on('stage_end.subject_id', '=', 'stage_start.subject_id')
                    ->whereColumn('stage_end.stage_at', '>=', 'stage_start.stage_at');
            })
            ->whereNull('stage_end.subject_id')
            ->select(['stage_start.project_code', 'stage_start.app_identifier', 'stage_start.platform', 'stage_start.subject_id', 'stage_start.stage_at']);
        $reasonBase = $this->baseQuery($params)
            ->where(function (Builder $query): void {
                $query->whereNotNull('blocked_reason')
                    ->orWhereNotNull('error_category')
                    ->orWhereNotNull('cache_reason');
            })
            ->select([
                'project_code', 'app_identifier', 'platform', 'my_user_id', 'event_time_utc', 'event_id',
                'blocked_reason', 'error_category', 'cache_reason',
            ]);
        $reasonEvents = DB::connection('adb')->query()
            ->fromSub($reasonBase, 'reason_event')
            ->joinSub($lost, 'lost_subject', function ($join): void {
                $join->on('lost_subject.project_code', '=', 'reason_event.project_code')
                    ->on('lost_subject.app_identifier', '=', 'reason_event.app_identifier')
                    ->on('lost_subject.platform', '=', 'reason_event.platform')
                    ->on('lost_subject.subject_id', '=', 'reason_event.my_user_id')
                    ->whereColumn('reason_event.event_time_utc', '>=', 'lost_subject.stage_at');
            })
            ->selectRaw("lost_subject.project_code, lost_subject.app_identifier, lost_subject.platform, lost_subject.subject_id, reason_event.event_time_utc, reason_event.event_id, COALESCE(NULLIF(reason_event.blocked_reason, ''), NULLIF(reason_event.error_category, ''), NULLIF(reason_event.cache_reason, ''), 'unknown') AS reason")
            ->orderBy('lost_subject.project_code')
            ->orderBy('lost_subject.subject_id')
            ->orderBy('reason_event.event_time_utc')
            ->orderBy('reason_event.event_id');

        $seen = [];
        $counts = [];
        foreach ($reasonEvents->cursor() as $row) {
            $subjectKey = implode('|', [$row->project_code, $row->app_identifier, $row->platform, $row->subject_id]);
            if (isset($seen[$subjectKey])) {
                continue;
            }
            $seen[$subjectKey] = true;
            $reason = (string) ($row->reason ?: 'unknown');
            $counts[$reason] = ($counts[$reason] ?? 0) + 1;
        }
        $unknown = max(0, $lostCount - count($seen));
        if ($unknown > 0) {
            $counts['unknown'] = ($counts['unknown'] ?? 0) + $unknown;
        }
        arsort($counts);

        return collect($counts)->map(fn (int $count, string $reason) => (object) [
            'reason' => $reason,
            'events' => $count,
            'users' => $count,
        ])->values();
    }

    /**
     * Compare funnel coverage across one approved diagnostic dimension.
     */
    private function cohort(array $params): array
    {
        $dimension = $params['dimension'] ?? 'app_version';
        $aggregate = $this->aggregateQuery($params)->first() ?: $this->emptyAggregate();
        $definitions = array_values(array_filter(
            $this->contextStages($aggregate, $params),
            fn (array $stage): bool => ($stage['available'] ?? true) !== false
        ));
        $codes = array_column($definitions, 'code');
        $defaultStartIndex = min(2, max(0, count($definitions) - 2));
        $startCode = (string) ($params['startStep'] ?? ($codes[$defaultStartIndex] ?? 'eligible'));
        $startIndex = array_search($startCode, $codes, true);
        if ($startIndex === false || $startIndex >= count($codes) - 1) {
            $startIndex = $defaultStartIndex;
            $startCode = (string) ($codes[$startIndex] ?? 'eligible');
        }
        $endCode = (string) ($params['endStep'] ?? ($codes[$startIndex + 1] ?? 'opportunity'));
        $endIndex = array_search($endCode, $codes, true);
        if ($endIndex === false || $endIndex <= $startIndex) {
            $endIndex = min($startIndex + 1, count($codes) - 1);
            $endCode = (string) ($codes[$endIndex] ?? 'opportunity');
        }

        $isEventUnit = ($params['domain'] ?? 'ads') === 'ads' && ($params['unit'] ?? 'users') === 'events';
        $orderedRows = $isEventUnit
            ? $this->eventCohortRows($params, $dimension, $startCode, $endCode)
            : $this->userCohortRows($params, $dimension, $startCode, $endCode);
        $summaryRows = $this->aggregateQuery($params)
            ->selectRaw("COALESCE(NULLIF({$dimension}, ''), '未知') AS dimension_value")
            ->groupBy('dimension_value')
            ->limit(50)
            ->get()
            ->keyBy(fn ($row): string => (string) $row->dimension_value);
        $items = $orderedRows->map(function ($row) use ($summaryRows): array {
            $value = (string) $row->dimension_value;
            $summary = $this->formatSummary($summaryRows->get($value) ?: $this->emptyAggregate());
            $startCount = (int) $row->start_count;
            $endCount = (int) $row->end_count;
            $lostCount = max(0, $startCount - $endCount);
            return [
                'value' => $value,
                'startCount' => $startCount,
                'endCount' => $endCount,
                'conversionRate' => $startCount > 0 ? $this->rate($endCount, $startCount) : null,
                'lostCount' => $lostCount,
                'estimatedRevenueImpact' => null,
                'isModelEstimate' => false,
                'revenueImpactAvailable' => false,
                'revenueImpactReason' => 'V1.7 未定义从漏斗流失量推算收入影响的模型',
            ] + $summary;
        })->sortByDesc('lostCount')->values();

        return [
            'context' => $this->context($params),
            'dimension' => $dimension,
            'selection' => [
                'startStep' => $startCode,
                'endStep' => $endCode,
                'ordered' => true,
            ],
            'items' => $items,
        ];
    }

    /** Group ordered UV conversions by the start event's approved dimension. */
    private function userCohortRows(array $params, string $dimension, string $startCode, string $endCode)
    {
        $start = $this->diagnosisUserStageQuery($params, $startCode, $dimension);
        $end = $this->diagnosisUserStageEventsQuery($params, $endCode);
        $converted = DB::connection('adb')->query()
            ->fromSub(clone $start, 'stage_start')
            ->joinSub($end, 'stage_end', function ($join): void {
                $join->on('stage_end.project_code', '=', 'stage_start.project_code')
                    ->on('stage_end.app_identifier', '=', 'stage_start.app_identifier')
                    ->on('stage_end.platform', '=', 'stage_start.platform')
                    ->on('stage_end.subject_id', '=', 'stage_start.subject_id')
                    ->whereColumn('stage_end.stage_at', '>=', 'stage_start.stage_at');
            })
            ->select([
                'stage_start.project_code',
                'stage_start.app_identifier',
                'stage_start.platform',
                'stage_start.subject_id',
                'stage_start.dimension_value',
            ])
            ->groupBy(
                'stage_start.project_code',
                'stage_start.app_identifier',
                'stage_start.platform',
                'stage_start.subject_id',
                'stage_start.dimension_value'
            );

        return DB::connection('adb')->query()
            ->fromSub($start, 'stage_start')
            ->leftJoinSub($converted, 'converted_start', function ($join): void {
                $join->on('converted_start.project_code', '=', 'stage_start.project_code')
                    ->on('converted_start.app_identifier', '=', 'stage_start.app_identifier')
                    ->on('converted_start.platform', '=', 'stage_start.platform')
                    ->on('converted_start.subject_id', '=', 'stage_start.subject_id')
                    ->on('converted_start.dimension_value', '=', 'stage_start.dimension_value');
            })
            ->selectRaw("COALESCE(NULLIF(stage_start.dimension_value, ''), '未知') AS dimension_value")
            ->selectRaw('COUNT(*) AS start_count')
            ->selectRaw('SUM(CASE WHEN converted_start.subject_id IS NOT NULL THEN 1 ELSE 0 END) AS end_count')
            ->groupBy('stage_start.dimension_value')
            ->limit(50)
            ->get();
    }

    /** Group ID-linked event conversions by the start event's approved dimension. */
    private function eventCohortRows(array $params, string $dimension, string $startCode, string $endCode)
    {
        $start = $this->diagnosisResolvedEventQuery($params, $startCode, $dimension);
        $end = $this->diagnosisResolvedEventQuery($params, $endCode);

        return DB::connection('adb')->query()
            ->fromSub($start, 'stage_start')
            ->leftJoinSub($end, 'stage_end', function ($join): void {
                $join->on('stage_end.project_code', '=', 'stage_start.project_code')
                    ->on('stage_end.app_identifier', '=', 'stage_start.app_identifier')
                    ->on('stage_end.platform', '=', 'stage_start.platform')
                    ->whereColumn('stage_end.stage_at', '>=', 'stage_start.stage_at')
                    ->whereRaw("((stage_start.opportunity_key IS NOT NULL AND stage_start.opportunity_key = stage_end.opportunity_key) OR (stage_start.request_key IS NOT NULL AND stage_start.request_key = stage_end.request_key) OR (stage_start.instance_key IS NOT NULL AND stage_start.instance_key = stage_end.instance_key))");
            })
            ->selectRaw("COALESCE(NULLIF(stage_start.dimension_value, ''), '未知') AS dimension_value")
            ->selectRaw('COUNT(DISTINCT stage_start.event_id) AS start_count')
            ->selectRaw('COUNT(DISTINCT CASE WHEN stage_end.event_id IS NOT NULL THEN stage_start.event_id END) AS end_count')
            ->groupBy('dimension_value')
            ->limit(50)
            ->get();
    }

    /**
     * Derive adjacent event paths around a selected loss step from ordered user timelines.
     */
    private function path(array $params): array
    {
        $pageRows = $this->baseQuery($params)
            ->whereNotNull('screen_name')
            ->where('screen_name', '!=', '')
            ->selectRaw('screen_name')
            ->selectRaw("COUNT(DISTINCT CASE WHEN event_name = 'screen_view' THEN NULLIF(my_user_id, '') END) AS screen_uv")
            ->selectRaw("SUM(CASE WHEN event_name = 'screen_view' THEN 1 ELSE 0 END) AS entry_count")
            ->selectRaw("SUM(CASE WHEN event_name = 'screen_exit' THEN 1 ELSE 0 END) AS exit_count")
            ->selectRaw("SUM(CASE WHEN error_code IS NOT NULL OR error_category IS NOT NULL THEN 1 ELSE 0 END) AS error_count")
            ->selectRaw("COUNT(DISTINCT CASE WHEN error_code IS NOT NULL OR error_category IS NOT NULL THEN NULLIF(my_user_id, '') END) AS error_users")
            ->groupBy('screen_name')
            ->havingRaw("SUM(CASE WHEN event_name = 'screen_view' THEN 1 ELSE 0 END) > 0")
            ->orderByDesc('screen_uv')
            ->limit(50)
            ->get();
        $monetizationByPage = $this->pageMonetization($params)->keyBy('screen_name');
        $funnelByPage = $this->pageFunnelMetrics($params)->keyBy('screen_name');
        $requestOutcomesByPage = $this->pageRequestOutcomeMetrics($params)->keyBy('screen_name');
        $correlatedImpressionsByPage = $this->pageCorrelatedImpressionMetrics($params)->keyBy('screen_name');
        $eligibilityReasonsByPage = $this->pageEligibilityReasonMetrics($params)->groupBy('screen_name');
        $pages = $pageRows->map(fn ($row) => $this->formatPageRow(
            $row,
            $monetizationByPage->get($row->screen_name),
            $funnelByPage->get($row->screen_name),
            $eligibilityReasonsByPage->get($row->screen_name, collect()),
            $requestOutcomesByPage->get($row->screen_name),
            $correlatedImpressionsByPage->get($row->screen_name)
        ))->values();
        $requestedScreen = $params['screenName'] ?? null;
        $selectedScreen = $pages->contains(fn (array $page): bool => $page['screenName'] === $requestedScreen)
            ? $requestedScreen
            : ($pages->first()['screenName'] ?? null);

        $screenEventBase = $this->baseQuery($params)
            ->where('event_name', 'screen_view')
            ->whereNotNull('my_user_id')
            ->where('my_user_id', '!=', '')
            ->whereNotNull('screen_name')
            ->where('screen_name', '!=', '');
        $omittedMissingSessionEvents = (clone $screenEventBase)
            ->where(function (Builder $query): void {
                $query->whereNull('session_id')->orWhere('session_id', '');
            })
            ->count();
        $screenEvents = $screenEventBase
            ->whereNotNull('session_id')
            ->where('session_id', '!=', '')
            ->select(['event_id', 'event_date', 'project_code', 'app_identifier', 'platform', 'my_user_id', 'session_id', 'screen_name', 'client_sequence', 'event_time_utc'])
            ->orderBy('project_code')
            ->orderBy('app_identifier')
            ->orderBy('platform')
            ->orderBy('event_date')
            ->orderBy('my_user_id')
            ->orderBy('session_id')
            ->orderBy('event_time_utc')
            ->orderBy('client_sequence')
            ->orderBy('event_id');

        $incoming = [];
        $outgoing = [];
        $chains = 0;
        $timelineKey = null;
        $previousScreen = null;
        foreach ($screenEvents->cursor() as $event) {
            $currentKey = implode('|', [
                $event->project_code,
                $event->app_identifier,
                $event->platform,
                $event->event_date,
                $event->my_user_id,
                $event->session_id,
            ]);
            if ($currentKey !== $timelineKey) {
                $timelineKey = $currentKey;
                $previousScreen = null;
            }
            $screen = (string) $event->screen_name;
            if ($screen === $previousScreen) {
                continue;
            }
            if ($screen === $selectedScreen) {
                $chains++;
                if ($previousScreen !== null) {
                    $incoming[$previousScreen] = ($incoming[$previousScreen] ?? 0) + 1;
                }
            } elseif ($previousScreen === $selectedScreen) {
                $outgoing[$screen] = ($outgoing[$screen] ?? 0) + 1;
            }
            $previousScreen = $screen;
        }

        arsort($incoming);
        arsort($outgoing);
        $selected = $pages->firstWhere('screenName', $selectedScreen);
        $elementRows = $this->baseQuery($params)
            ->where('screen_name', $selectedScreen)
            ->where('event_name', 'element_click')
            ->get(['my_user_id', 'event_params_json']);
        $elementCounts = [];
        $allClickUsers = [];
        foreach ($elementRows as $row) {
            $eventParams = json_decode((string) $row->event_params_json, true) ?: [];
            $elementName = (string) ($eventParams['element_name'] ?? $eventParams['action_name'] ?? 'unknown');
            $elementCounts[$elementName] ??= ['clickCount' => 0, 'users' => []];
            $elementCounts[$elementName]['clickCount']++;
            if ($row->my_user_id !== null && $row->my_user_id !== '') {
                $elementCounts[$elementName]['users'][(string) $row->my_user_id] = true;
                $allClickUsers[(string) $row->my_user_id] = true;
            }
        }
        uasort($elementCounts, fn (array $left, array $right): int => $right['clickCount'] <=> $left['clickCount']);
        $elements = collect($elementCounts)->take(20)->map(fn (array $item, string $name): array => [
            'elementName' => $name,
            'clickUsers' => count($item['users']),
            'clickCount' => $item['clickCount'],
        ])->values()->all();

        return [
            'context' => $this->context($params),
            'selectedScreen' => $selectedScreen,
            'sampleChains' => $chains,
            'pages' => $pages,
            'incoming' => $this->pathItems($incoming, $chains, 'screenName'),
            'outgoing' => $this->pathItems($outgoing, $chains, 'screenName'),
            'before' => $this->pathItems($incoming, $chains),
            'after' => $this->pathItems($outgoing, $chains),
            'elements' => $elements,
            'elementClickUsers' => count($allClickUsers),
            'monetization' => $selected ? [
                'opportunityUsers' => $selected['opportunityUsers'],
                'impressionUsers' => $selected['impressionUsers'],
                'viewerRate' => $selected['viewerRate'],
                'impressionCount' => $selected['impressionCount'],
                'revenue' => $selected['revenue'],
            ] : [],
            'performance' => $selected ? [
                'errorCount' => $selected['errorCount'],
                'errorRate' => $selected['errorRate'],
                'errorRateAvailable' => $selected['errorRateAvailable'],
            ] : [],
            'limited' => $omittedMissingSessionEvents > 0,
            'omittedMissingSessionEvents' => $omittedMissingSessionEvents,
        ];
    }

    /**
     * Attribute impressions and paid value to the page that emitted the linked opportunity.
     */
    private function pageMonetization(array $params)
    {
        $opportunities = $this->baseQuery($params)
            ->where('event_name', 'ad_opportunity')
            ->whereNotNull('opportunity_id')
            ->where('opportunity_id', '!=', '')
            ->whereNotNull('screen_name')
            ->where('screen_name', '!=', '')
            ->selectRaw('project_code, app_identifier, platform, event_date, opportunity_id, MAX(screen_name) AS screen_name, MAX(NULLIF(my_user_id, \'\')) AS opportunity_user')
            ->groupBy('project_code', 'app_identifier', 'platform', 'event_date', 'opportunity_id');
        $outcomes = $this->baseQuery($params)
            ->whereIn('event_name', ['ad_impression', 'ad_paid_event'])
            ->whereNotNull('opportunity_id')
            ->where('opportunity_id', '!=', '')
            ->select(['project_code', 'app_identifier', 'platform', 'event_date', 'opportunity_id', 'event_name', 'my_user_id', 'event_id', 'value_micros']);

        return DB::connection('adb')->query()
            ->fromSub($opportunities, 'page_opportunity')
            ->leftJoinSub($outcomes, 'page_outcome', function ($join): void {
                $join->on('page_outcome.project_code', '=', 'page_opportunity.project_code')
                    ->on('page_outcome.app_identifier', '=', 'page_opportunity.app_identifier')
                    ->on('page_outcome.platform', '=', 'page_opportunity.platform')
                    ->on('page_outcome.event_date', '=', 'page_opportunity.event_date')
                    ->on('page_outcome.opportunity_id', '=', 'page_opportunity.opportunity_id');
            })
            ->selectRaw('page_opportunity.screen_name')
            ->selectRaw('COUNT(DISTINCT page_opportunity.opportunity_user) AS opportunity_users')
            ->selectRaw("COUNT(DISTINCT CASE WHEN page_outcome.event_name = 'ad_impression' THEN page_outcome.my_user_id END) AS impression_users")
            ->selectRaw("COUNT(DISTINCT CASE WHEN page_outcome.event_name = 'ad_impression' THEN page_outcome.event_id END) AS impression_count")
            ->selectRaw("SUM(CASE WHEN page_outcome.event_name = 'ad_paid_event' THEN COALESCE(page_outcome.value_micros, 0) ELSE 0 END) AS revenue_micros")
            ->groupBy('page_opportunity.screen_name')
            ->get();
    }

    /**
     * 读取页面广告漏斗日汇总；无法表达的明细筛选继续由现有 DWD 页面指标承担。
     */
    private function pageFunnelMetrics(array $params)
    {
        $unsupportedFilters = [
            'sourceType', 'buildNumber', 'networkType', 'deviceModel', 'placement',
            'adFormat', 'adSource', 'qualityStatus', 'eventModule',
        ];
        foreach ($unsupportedFilters as $filter) {
            if (!empty($params[$filter])) {
                return collect();
            }
        }

        try {
            $table = (string) config(
                'adb.funnel_aggregates.tables.ad_page_funnel_daily',
                'dws_ad_page_funnel_daily'
            );
            $query = DB::connection('adb')->table($table)
                ->whereBetween('stat_date', [$params['dateFrom'], $params['dateTo']]);
            foreach ([
                'projectCode' => 'project_code',
                'appIdentifier' => 'app_identifier',
                'platform' => 'platform',
            ] as $key => $column) {
                if (!empty($params[$key])) {
                    $query->where($column, $params[$key]);
                }
            }
            $query->where('country', !empty($params['country']) ? $params['country'] : 'ALL')
                ->where('app_version', !empty($params['appVersion']) ? $params['appVersion'] : 'ALL');
            if (empty($params['projectCode']) && !empty($params['projectCodes'])) {
                $query->whereIn('project_code', $params['projectCodes']);
            }

            return $query
                ->selectRaw('screen_name')
                ->selectRaw('SUM(page_users) AS page_users')
                ->selectRaw('SUM(eligibility_check_users) AS eligibility_check_users')
                ->selectRaw('SUM(eligible_users) AS eligible_users')
                ->selectRaw('SUM(opportunity_users) AS opportunity_users')
                ->selectRaw('SUM(request_users) AS request_users')
                ->selectRaw('SUM(preload_request_users) AS preload_request_users')
                ->selectRaw('SUM(cache_hit_users) AS cache_hit_users')
                ->selectRaw('SUM(show_attempt_users) AS show_attempt_users')
                ->selectRaw('SUM(impression_users) AS impression_users')
                ->groupBy('screen_name')
                ->get();
        } catch (Throwable) {
            return collect();
        }
    }

    /**
     * 从 V1.8 DWD 明细实时回算页面级请求终态；用于补齐汇总表暂未包含的字段。
     */
    private function pageRequestOutcomeMetrics(array $params)
    {
        try {
            $events = $this->attributedPageEvents($params, [
                'ad_request',
                'ad_load_success',
                'ad_load_failed',
            ]);

            $summary = DB::connection('adb')->query()
                ->fromSub($events, 'page_event')
                ->where('page_event.screen_rank', 1)
                ->selectRaw('page_event.attributed_screen_name AS screen_name')
                ->selectRaw("COUNT(DISTINCT CASE WHEN page_event.event_name = 'ad_request' THEN NULLIF(page_event.my_user_id, '') END) AS request_users")
                ->selectRaw("COUNT(DISTINCT CASE WHEN page_event.event_name = 'ad_load_success' THEN NULLIF(page_event.my_user_id, '') END) AS request_success_users")
                ->selectRaw("COUNT(DISTINCT CASE WHEN page_event.event_name = 'ad_load_success' THEN NULLIF(page_event.request_id, '') END) AS request_success_count")
                ->selectRaw("COUNT(DISTINCT CASE WHEN page_event.event_name = 'ad_load_failed' THEN NULLIF(page_event.my_user_id, '') END) AS request_failed_users")
                ->selectRaw("COUNT(DISTINCT CASE WHEN page_event.event_name = 'ad_load_failed' THEN NULLIF(page_event.request_id, '') END) AS request_failed_count")
                ->groupBy('page_event.attributed_screen_name')
                ->get()
                ->keyBy('screen_name');

            $failedEvents = $this->attributedPageEvents($params, ['ad_load_failed']);
            $failed = DB::connection('adb')->query()
                ->fromSub($failedEvents, 'page_event')
                ->where('page_event.screen_rank', 1)
                ->get();
            $reasonBuckets = [];
            foreach ($failed as $row) {
                $screen = (string) ($row->attributed_screen_name ?? 'unknown');
                $paramsJson = json_decode((string) ($row->event_params_json ?? ''), true) ?: [];
                $errorCode = (string) ($row->error_code ?? $paramsJson['error_code'] ?? 'unknown');
                $errorDomain = (string) ($paramsJson['error_domain'] ?? $paramsJson['domain'] ?? $row->error_category ?? 'unknown');
                $reasonKey = $errorDomain . '|' . $errorCode;
                $reasonBuckets[$screen][$reasonKey] ??= [
                    'screen_name' => $screen,
                    'error_code' => $errorCode,
                    'error_domain' => $errorDomain,
                    'error_category' => (string) ($row->error_category ?? $paramsJson['error_category'] ?? ''),
                    'users' => [],
                    'requests' => [],
                    'events' => 0,
                ];
                if (!empty($row->my_user_id)) {
                    $reasonBuckets[$screen][$reasonKey]['users'][(string) $row->my_user_id] = true;
                }
                if (!empty($row->request_id)) {
                    $reasonBuckets[$screen][$reasonKey]['requests'][(string) $row->request_id] = true;
                }
                $reasonBuckets[$screen][$reasonKey]['events']++;
            }

            return $summary->map(function ($row) use ($reasonBuckets) {
                $screen = (string) $row->screen_name;
                $reasons = collect($reasonBuckets[$screen] ?? [])->map(function (array $reason) {
                    return [
                        'errorCode' => $reason['error_code'],
                        'errorDomain' => $reason['error_domain'],
                        'errorCategory' => $reason['error_category'],
                        'users' => count($reason['users']),
                        'requests' => count($reason['requests']),
                        'events' => $reason['events'],
                    ];
                })->sortByDesc('events')->values();
                $top = $reasons->first();
                $row->top_request_fail_reason = $top
                    ? trim(($top['errorDomain'] ?: 'unknown') . ':' . ($top['errorCode'] ?: 'unknown'), ':')
                    : null;
                $row->error_code = $top['errorCode'] ?? null;
                $row->error_domain = $top['errorDomain'] ?? null;
                $row->request_fail_reasons = $reasons->all();
                $row->request_breakdown_source = 'derived_from_v18_dwd';

                return $row;
            })->values();
        } catch (Throwable) {
            return collect();
        }
    }

    /**
     * 用同一用户/session 的页面访问与广告展示做近邻关联，回答“这个页面用户后来是否展示广告”。
     */
    private function pageCorrelatedImpressionMetrics(array $params)
    {
        try {
            $screenViews = $this->baseQuery($params)
                ->where('event_name', 'screen_view')
                ->whereNotNull('my_user_id')
                ->where('my_user_id', '!=', '')
                ->whereNotNull('session_id')
                ->where('session_id', '!=', '')
                ->whereNotNull('screen_name')
                ->where('screen_name', '!=', '')
                ->select(['project_code', 'app_identifier', 'platform', 'my_user_id', 'session_id', 'screen_name', 'event_time_utc']);
            $impressions = $this->baseQuery($params)
                ->where('event_name', 'ad_impression')
                ->whereNotNull('my_user_id')
                ->where('my_user_id', '!=', '')
                ->whereNotNull('session_id')
                ->where('session_id', '!=', '')
                ->select(['project_code', 'app_identifier', 'platform', 'my_user_id', 'session_id', 'event_time_utc']);

            return DB::connection('adb')->query()
                ->fromSub($screenViews, 'page_view')
                ->leftJoinSub($impressions, 'impression_event', function ($join): void {
                    $join->on('impression_event.project_code', '=', 'page_view.project_code')
                        ->on('impression_event.app_identifier', '=', 'page_view.app_identifier')
                        ->on('impression_event.platform', '=', 'page_view.platform')
                        ->on('impression_event.my_user_id', '=', 'page_view.my_user_id')
                        ->on('impression_event.session_id', '=', 'page_view.session_id')
                        ->whereColumn('impression_event.event_time_utc', '>=', 'page_view.event_time_utc')
                        ->whereRaw('impression_event.event_time_utc <= DATE_ADD(page_view.event_time_utc, INTERVAL 30 MINUTE)');
                })
                ->selectRaw('page_view.screen_name')
                ->selectRaw('COUNT(DISTINCT page_view.my_user_id) AS page_users_for_correlation')
                ->selectRaw('COUNT(DISTINCT CASE WHEN impression_event.my_user_id IS NOT NULL THEN page_view.my_user_id END) AS correlated_impression_users')
                ->groupBy('page_view.screen_name')
                ->get()
                ->map(function ($row) {
                    $row->impression_correlation_source = 'derived_from_v18_dwd_same_session_30m';

                    return $row;
                });
        } catch (Throwable) {
            return collect();
        }
    }

    private function attributedPageEvents(array $params, array $eventNames): Builder
    {
        $screenParams = $params;
        $screenParams['dateFrom'] = Carbon::parse($params['dateFrom'])->subDay()->toDateString();
        foreach (['placement', 'adFormat', 'adSource', 'qualityStatus', 'eventModule'] as $filter) {
            unset($screenParams[$filter]);
        }

        $events = $this->baseQuery($params)
            ->whereIn('event_name', $eventNames)
            ->select([
                'event_id', 'event_date', 'project_code', 'app_identifier', 'platform',
                'event_name', 'my_user_id', 'session_id', 'screen_name', 'event_time_utc',
                'client_sequence', 'request_id', 'error_code', 'error_category', 'event_params_json',
            ]);
        $screenViews = $this->baseQuery($screenParams)
            ->where('event_name', 'screen_view')
            ->whereNotNull('my_user_id')
            ->where('my_user_id', '!=', '')
            ->whereNotNull('session_id')
            ->where('session_id', '!=', '')
            ->whereNotNull('screen_name')
            ->where('screen_name', '!=', '')
            ->select(['event_id', 'project_code', 'app_identifier', 'platform', 'my_user_id', 'session_id', 'screen_name', 'event_time_utc', 'client_sequence']);

        return DB::connection('adb')->query()
            ->fromSub($events, 'e')
            ->leftJoinSub($screenViews, 'sv', function ($join): void {
                $join->on('sv.project_code', '=', 'e.project_code')
                    ->on('sv.app_identifier', '=', 'e.app_identifier')
                    ->on('sv.platform', '=', 'e.platform')
                    ->on('sv.my_user_id', '=', 'e.my_user_id')
                    ->on('sv.session_id', '=', 'e.session_id')
                    ->whereColumn('sv.event_time_utc', '<=', 'e.event_time_utc')
                    ->whereRaw('sv.event_time_utc >= DATE_SUB(e.event_time_utc, INTERVAL 30 MINUTE)');
            })
            ->selectRaw('e.*')
            ->selectRaw("COALESCE(NULLIF(e.screen_name, ''), NULLIF(sv.screen_name, ''), 'unknown') AS attributed_screen_name")
            ->selectRaw('ROW_NUMBER() OVER (
                PARTITION BY e.event_date, e.project_code, e.app_identifier, e.event_id
                ORDER BY sv.event_time_utc DESC, sv.client_sequence DESC, sv.event_id DESC
            ) AS screen_rank');
    }

    /** 读取页面资格拦截原因汇总，供路径页面直接展示原因分布。 */
    private function pageEligibilityReasonMetrics(array $params)
    {
        foreach ([
            'sourceType', 'buildNumber', 'networkType', 'deviceModel', 'placement',
            'adFormat', 'adSource', 'qualityStatus', 'eventModule',
        ] as $filter) {
            if (!empty($params[$filter])) {
                return collect();
            }
        }

        try {
            $table = (string) config(
                'adb.funnel_aggregates.tables.ad_eligibility_reason_daily',
                'dws_ad_eligibility_reason_daily'
            );
            $query = DB::connection('adb')->table($table)
                ->whereBetween('stat_date', [$params['dateFrom'], $params['dateTo']]);
            foreach ([
                'projectCode' => 'project_code',
                'appIdentifier' => 'app_identifier',
                'platform' => 'platform',
            ] as $key => $column) {
                if (!empty($params[$key])) {
                    $query->where($column, $params[$key]);
                }
            }
            $query->where('country', !empty($params['country']) ? $params['country'] : 'ALL')
                ->where('app_version', !empty($params['appVersion']) ? $params['appVersion'] : 'ALL');
            if (empty($params['projectCode']) && !empty($params['projectCodes'])) {
                $query->whereIn('project_code', $params['projectCodes']);
            }

            return $query
                ->selectRaw('screen_name, blocked_reason')
                ->selectRaw('SUM(blocked_users) AS blocked_users')
                ->selectRaw('SUM(blocked_sessions) AS blocked_sessions')
                ->selectRaw('SUM(blocked_events) AS blocked_events')
                ->groupBy('screen_name', 'blocked_reason')
                ->orderByDesc('blocked_events')
                ->get();
        } catch (Throwable) {
            return collect();
        }
    }

    /**
     * Return paginated event evidence with sanitized, standardized parameters.
     */
    private function evidence(array $params): array
    {
        $page = (int) ($params['pageIndex'] ?? 1);
        $pageSize = (int) ($params['pageSize'] ?? 20);
        $mode = (string) ($params['evidenceMode'] ?? 'ad');
        $anchor = $this->evidenceAnchor($params, $mode);
        $query = $anchor
            ? ($mode === 'ad'
                ? $this->adEvidenceChainQuery($params, $anchor)
                : $this->userEvidenceChainQuery($params, $anchor))
            : $this->evidenceModeQuery($params, $mode);
        if (!$anchor && !empty($params['eventName'])) {
            $query->where('event_name', $params['eventName']);
        }
        if (!$anchor && !empty($params['keyword'])) {
            $keyword = '%' . $params['keyword'] . '%';
            $query->where(function (Builder $builder) use ($keyword): void {
                $builder->where('event_id', 'like', $keyword)
                    ->orWhere('my_user_id', 'like', $keyword)
                    ->orWhere('request_id', 'like', $keyword)
                    ->orWhere('opportunity_id', 'like', $keyword)
                    ->orWhere('event_name', 'like', $keyword)
                    ->orWhere('screen_name', 'like', $keyword)
                    ->orWhere('app_version', 'like', $keyword)
                    ->orWhere('country_code', 'like', $keyword)
                    ->orWhere('network_type', 'like', $keyword)
                    ->orWhere('device_model', 'like', $keyword)
                    ->orWhere('ad_format', 'like', $keyword)
                    ->orWhere('placement', 'like', $keyword)
                    ->orWhere('blocked_reason', 'like', $keyword)
                    ->orWhere('error_category', 'like', $keyword)
                    ->orWhere('cache_reason', 'like', $keyword);
            });
        }

        $scopeTotal = (clone $query)->count();
        $abnormalTotal = (clone $query)->where(fn (Builder $builder) => $this->applyAbnormalEvidenceFilter($builder))->count();
        if (!empty($params['onlyAbnormal'])) {
            $query->where(fn (Builder $builder) => $this->applyAbnormalEvidenceFilter($builder));
        }
        $total = (clone $query)->count();
        $items = $query->orderByDesc('event_time_utc')
            ->orderByDesc('client_sequence')
            ->orderByDesc('event_id')
            ->forPage($page, $pageSize)
            ->get([
                'event_id', 'event_date', 'event_time_utc', 'client_sequence', 'project_code', 'app_identifier', 'platform', 'app_version',
                'event_name', 'my_user_id', 'session_id', 'screen_name', 'country_code', 'network_type',
                'opportunity_id', 'request_id', 'ad_instance_id', 'result_status', 'error_category',
                'error_code', 'error_message', 'blocked_reason', 'is_preload', 'cache_status', 'placement',
                'ad_source', 'quality_status', 'data_status', 'source_mask', 'api_seen', 'firebase_seen',
                'event_params_json',
            ])
            ->map(function ($row): array {
                $eventParams = $this->sanitizeEvidenceParams(
                    json_decode((string) $row->event_params_json, true) ?: []
                );
                $isAbnormal = $this->isAbnormalEvidenceRow($row);

                return [
                    'eventId' => $row->event_id,
                    'eventDate' => $row->event_date,
                    'eventTime' => $row->event_time_utc,
                    'clientSequence' => $row->client_sequence,
                    'projectCode' => $row->project_code,
                    'appIdentifier' => $row->app_identifier,
                    'platform' => $row->platform,
                    'appVersion' => $row->app_version,
                    'eventName' => $row->event_name,
                    'myUserId' => $this->maskEvidenceIdentifier($row->my_user_id),
                    'sessionId' => $this->maskEvidenceIdentifier($row->session_id),
                    'screenName' => $row->screen_name,
                    'countryCode' => $row->country_code,
                    'networkType' => $row->network_type,
                    'opportunityId' => $row->opportunity_id,
                    'requestId' => $row->request_id,
                    'requestType' => $eventParams['request_type'] ?? null,
                    'isPreload' => $row->is_preload === null ? null : (bool) $row->is_preload,
                    'cacheStatus' => $row->cache_status,
                    'adInstanceId' => $row->ad_instance_id,
                    'placement' => $row->placement,
                    'adSource' => $row->ad_source,
                    'resultStatus' => $row->result_status,
                    'errorCategory' => $row->error_category,
                    'errorCode' => $row->error_code,
                    'errorMessage' => $this->sanitizeEvidenceText($row->error_message),
                    'blockedReason' => $row->blocked_reason,
                    'qualityStatus' => $row->quality_status,
                    'dataStatus' => $row->data_status,
                    'sourceMask' => (int) $row->source_mask,
                    'sourceLabel' => $this->sourceLabel((bool) $row->api_seen, (bool) $row->firebase_seen),
                    'isAbnormal' => $isAbnormal,
                    'eventParams' => $eventParams,
                ];
            });

        return compact('items', 'total', 'page', 'pageSize', 'scopeTotal', 'abnormalTotal') + [
            'chain' => [
                'mode' => $mode,
                'anchored' => $anchor !== null,
                'anchorEventId' => $anchor?->event_id,
            ],
            'context' => $this->context($params),
        ];
    }

    /** Resolve one exact event as the evidence-chain anchor inside the authorized filter scope. */
    private function evidenceAnchor(array $params, string $mode): ?object
    {
        if (empty($params['anchorEventId'])) {
            return null;
        }

        $query = $this->baseQuery($params)->where('event_id', $params['anchorEventId']);
        if ($mode === 'ad') {
            $this->applyAdEvidenceEventFilter($query);
        }

        return $query->orderByDesc('event_date')->first([
            'event_id', 'project_code', 'app_identifier', 'platform', 'my_user_id', 'session_id',
            'opportunity_id', 'request_id', 'ad_instance_id',
        ]);
    }

    /** Build an unanchored evidence list for the requested user or advertising scope. */
    private function evidenceModeQuery(array $params, string $mode): Builder
    {
        $query = $this->baseQuery($mode === 'user' ? $this->evidenceChainParams($params) : $params);
        if ($mode === 'ad') {
            $this->applyAdEvidenceEventFilter($query);
        }

        return $query;
    }

    /** Restrict a user chain to one project, application, platform and foreground session. */
    private function userEvidenceChainQuery(array $params, object $anchor): Builder
    {
        $query = $this->baseQuery($this->evidenceChainParams($params))
            ->where('project_code', $anchor->project_code)
            ->where('app_identifier', $anchor->app_identifier)
            ->where('platform', $anchor->platform)
            ->where('my_user_id', $anchor->my_user_id);
        if ($anchor->session_id !== null && $anchor->session_id !== '') {
            return $query->where('session_id', $anchor->session_id);
        }

        // Without a session boundary, returning the user's entire date range
        // would create a synthetic evidence chain across unrelated sessions.
        return $query->where('event_id', $anchor->event_id);
    }

    /**
     * Expand an advertising chain through opportunity, request and ad-instance IDs.
     * Two passes bridge rows such as load_success that intentionally omit opportunity_id.
     */
    private function adEvidenceChainQuery(array $params, object $anchor): Builder
    {
        $identifiers = [
            'opportunity_id' => $this->evidenceIdentifierValues([$anchor->opportunity_id]),
            'request_id' => $this->evidenceIdentifierValues([$anchor->request_id]),
            'ad_instance_id' => $this->evidenceIdentifierValues([$anchor->ad_instance_id]),
        ];
        $base = $this->baseQuery($this->evidenceChainParams($params))
            ->where('project_code', $anchor->project_code)
            ->where('app_identifier', $anchor->app_identifier)
            ->where('platform', $anchor->platform);
        $this->applyAdEvidenceEventFilter($base);

        for ($pass = 0; $pass < 2; $pass++) {
            if (collect($identifiers)->flatten()->isEmpty()) {
                return $base->where('event_id', $anchor->event_id);
            }
            $linked = (clone $base)
                ->where(fn (Builder $builder) => $this->applyEvidenceIdentifierFilter($builder, $identifiers))
                ->get(['opportunity_id', 'request_id', 'ad_instance_id']);
            $expanded = [
                'opportunity_id' => $this->evidenceIdentifierValues(array_merge(
                    $identifiers['opportunity_id'],
                    $linked->pluck('opportunity_id')->all()
                )),
                'request_id' => $this->evidenceIdentifierValues(array_merge(
                    $identifiers['request_id'],
                    $linked->pluck('request_id')->all()
                )),
                'ad_instance_id' => $this->evidenceIdentifierValues(array_merge(
                    $identifiers['ad_instance_id'],
                    $linked->pluck('ad_instance_id')->all()
                )),
            ];
            if ($expanded === $identifiers) {
                break;
            }
            $identifiers = $expanded;
        }

        return $base->where(fn (Builder $builder) => $this->applyEvidenceIdentifierFilter($builder, $identifiers));
    }

    /** Keep advertising evidence in the ads event family without trusting event_module alone. */
    private function applyAdEvidenceEventFilter(Builder $query): void
    {
        $query->where(function (Builder $builder): void {
            $builder->where('event_name', 'like', 'ad_%')
                ->orWhere('event_name', 'like', 'banner_%');
        });
    }

    /** Remove event-specific drill-down filters after the anchor has established the selected slice. */
    private function evidenceChainParams(array $params): array
    {
        foreach (['placement', 'adFormat', 'adSource', 'qualityStatus', 'eventModule'] as $key) {
            unset($params[$key]);
        }

        return $params;
    }

    /** Apply one OR group across every populated advertising business identifier. */
    private function applyEvidenceIdentifierFilter(Builder $query, array $identifiers): void
    {
        $applied = false;
        foreach ($identifiers as $column => $values) {
            if ($values === []) {
                continue;
            }
            $applied ? $query->orWhereIn($column, $values) : $query->whereIn($column, $values);
            $applied = true;
        }
        if (!$applied) {
            $query->whereRaw('1 = 0');
        }
    }

    /** Normalize non-empty chain identifiers while preserving stable comparison order. */
    private function evidenceIdentifierValues(array $values): array
    {
        return array_values(array_unique(array_map(
            'strval',
            array_filter($values, fn ($value): bool => $value !== null && $value !== '')
        )));
    }

    /** Define the one server-side abnormal evidence predicate used by count and pagination. */
    private function applyAbnormalEvidenceFilter(Builder $query): void
    {
        $query->where(function (Builder $builder): void {
            $builder->whereNotNull('error_code')->where('error_code', '!=', '')
                ->orWhere(function (Builder $nested): void {
                    $nested->whereNotNull('error_category')->where('error_category', '!=', '');
                })
                ->orWhere(function (Builder $nested): void {
                    $nested->whereNotNull('blocked_reason')->where('blocked_reason', '!=', '');
                })
                ->orWhere('quality_status', 'warning')
                ->orWhereIn('result_status', ['failed', 'failure', 'blocked', 'invalid', 'timeout', 'cancelled']);
        });
    }

    /** Match the SQL abnormal predicate when formatting each evidence row. */
    private function isAbnormalEvidenceRow(object $row): bool
    {
        return ($row->error_code !== null && $row->error_code !== '')
            || ($row->error_category !== null && $row->error_category !== '')
            || ($row->blocked_reason !== null && $row->blocked_reason !== '')
            || $row->quality_status === 'warning'
            || in_array(strtolower((string) $row->result_status), ['failed', 'failure', 'blocked', 'invalid', 'timeout', 'cancelled'], true);
    }

    /** Recursively redact direct user identifiers and PII from evidence JSON responses. */
    private function sanitizeEvidenceParams(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        $sanitized = [];
        foreach ($value as $key => $item) {
            if (is_string($key) && preg_match(
                '/^(?:my_user_id|user_id|user_pseudo_id|firebase_user_pseudo_id|session_id|device_id|advertising_id|gaid|idfa|email|user_email|phone|phone_number|ip|ip_address|ip_before_connect|ip_after_connect)$/i',
                $key
            ) === 1) {
                $sanitized[$key] = '[REDACTED]';
                continue;
            }
            $sanitized[$key] = $this->sanitizeEvidenceParams($item);
        }

        return $sanitized;
    }

    /** Mask identifiers while retaining enough prefix/suffix context for evidence comparison. */
    private function maskEvidenceIdentifier(mixed $value): ?string
    {
        $identifier = trim((string) $value);
        if ($identifier === '') {
            return null;
        }
        if (strlen($identifier) <= 8) {
            return substr($identifier, 0, 1) . '***' . substr($identifier, -1);
        }

        return substr($identifier, 0, 4) . '***' . substr($identifier, -4);
    }

    /** Redact common credentials and direct identifiers embedded in free-form error text. */
    private function sanitizeEvidenceText(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return $value === null ? null : '';
        }

        return preg_replace(
            [
                '/\bBearer\s+[^\s,;]+/i',
                '/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/',
                '/\b(?:\d{1,3}\.){3}\d{1,3}\b/',
                '/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i',
            ],
            ['Bearer [REDACTED]', '[REDACTED-JWT]', '[REDACTED-IP]', '[REDACTED-EMAIL]'],
            (string) $value
        );
    }

    /**
     * Read issue workflow records from RDS; evidence remains in ADB.
     */
    private function issues(array $params): array
    {
        if (!Schema::hasTable('funnel_diagnosis_issue')) {
            return [
                'context' => $this->context($params),
                'items' => [],
                'total' => 0,
                'available' => false,
                'selectedIssue' => null,
                'qualityGates' => $this->unavailableQualityGates('RDS 尚未创建问题工作流表'),
                'evidence' => ['available' => false, 'items' => [], 'total' => 0],
                'activities' => [],
            ];
        }

        $query = DB::table('funnel_diagnosis_issue')->orderByDesc('updated_at');
        if (!empty($params['projectCode'])) {
            $query->where('project_code', $params['projectCode']);
        } elseif (!empty($params['projectCodes'])) {
            $query->whereIn('project_code', $params['projectCodes']);
        }
        $page = max(1, (int) ($params['pageIndex'] ?? 1));
        $pageSize = min(100, max(1, (int) ($params['pageSize'] ?? 100)));
        $total = (clone $query)->count();
        $rows = (clone $query)->forPage($page, $pageSize)->get();
        $selectedRow = !empty($params['issueId'])
            ? (clone $query)->where('issue_id', $params['issueId'])->first()
            : null;
        $selectedRow ??= $rows->first();
        $selectedIssue = $selectedRow ? $this->formatIssueDetail($selectedRow) : null;
        $verificationScope = $selectedRow ? $this->issueScope($selectedRow, 'verification') : null;

        return [
            'context' => $this->context($params),
            'items' => $rows->map(fn ($row) => $this->formatIssue($row))->values()->all(),
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
            'available' => true,
            'selectedIssue' => $selectedIssue,
            'qualityGates' => $verificationScope
                ? $this->issueQualityGates($verificationScope)
                : $this->unavailableQualityGates('尚未设置修复后验证区间，不能计算发布门禁'),
            'qualityGateContext' => $verificationScope ? $this->context($verificationScope) : null,
            'evidence' => $selectedRow
                ? $this->issueEvidence((string) $selectedRow->issue_id)
                : ['available' => true, 'items' => [], 'total' => 0],
            'activities' => $selectedRow ? $this->issueActivities($selectedRow) : [],
        ];
    }

    /**
     * Return the published RDS definition, or an explicitly identified built-in V1.7 fallback.
     */
    private function snapshot(): array
    {
        if (Schema::hasTable('funnel_version') && Schema::hasTable('funnel_step')) {
            $version = DB::table('funnel_version')->where('status', 'PUBLISHED')->orderByDesc('published_at')->first();
            if ($version) {
                $steps = DB::table('funnel_step')->where('funnel_version_id', $version->funnel_version_id)->orderBy('step_order')->get();
                return [
                    'source' => 'rds',
                    'version' => $version,
                    'steps' => $steps,
                ];
            }
        }

        return [
            'source' => 'builtin',
            'version' => [
                'funnel_version_id' => self::BUILTIN_VERSION_ID,
                'version' => 'V1.7',
                'status' => 'BUILTIN',
                'subject_key_rule' => 'USER 使用 my_user_id 去重；EVENT 使用 event_id 去重',
                'time_window_rule' => '按筛选日期范围聚合，路径样本按 event_time_utc 排序',
                'source_rule' => 'dwd_app_tracking_event 标准事件明细',
                'dedupe_rule' => 'event_id + event_date 主键去重',
                'missing_data_rule' => '隔离表事件不进入正式漏斗',
            ],
            'steps' => collect(self::FUNNEL_STEPS)->map(fn ($step, $index) => [
                'funnel_step_id' => 'builtin-step-' . $step['code'],
                'funnel_version_id' => self::BUILTIN_VERSION_ID,
                'step_code' => $step['code'],
                'step_name' => $step['name'],
                'step_order' => $index + 1,
                'event_name' => $step['event'],
                'subject_field' => 'my_user_id',
                'filter_expression' => !empty($step['eligible']) ? ['eligible' => true] : null,
            ])->all(),
        ];
    }

    /**
     * Persist a user-created diagnosis task in the RDS control plane.
     */
    public function storeIssue(array $data, int|string|null $actorId): array
    {
        if (!Schema::hasTable('funnel_diagnosis_issue')) {
            throw new InvalidArgumentException('RDS 尚未创建 funnel_diagnosis_issue 表');
        }

        $issueId = 'FDI-' . Str::upper((string) Str::ulid());
        $now = now();
        $evidence = $this->resolveIssueEvidence($data);
        $row = [
            'issue_id' => $issueId,
            'project_code' => $data['projectCode'],
            'app_identifier' => $data['appIdentifier'],
            'funnel_version_id' => $data['funnelVersionId'] ?? self::BUILTIN_VERSION_ID,
            'issue_type' => $data['issueType'],
            'severity' => $data['severity'],
            'status' => 'OPEN',
            'title' => $data['title'],
            'description' => $data['description'],
            'owner_id' => $data['ownerId'] ?? null,
            'baseline_start_date' => $data['baselineStartDate'] ?? null,
            'baseline_end_date' => $data['baselineEndDate'] ?? null,
            'target_version' => $data['targetVersion'] ?? null,
            'metric_code' => $data['metricCode'] ?? null,
            'sla_due_at' => $data['slaDueAt'] ?? null,
            'created_by' => $actorId ? (string) $actorId : null,
            'updated_by' => $actorId ? (string) $actorId : null,
            'created_at' => $now,
            'updated_at' => $now,
        ];
        $baselineMetric = $this->issueMetricForRecord((object) $row, 'baseline');
        $row['baseline_metric_value'] = $baselineMetric['available'] ? $baselineMetric['value'] : null;

        DB::transaction(fn () => DB::table('funnel_diagnosis_issue')->insert($row));
        if ($evidence) {
            try {
                $this->persistIssueEvidence($issueId, $evidence, $data['metricCode'] ?? null, $actorId, $now);
            } catch (Throwable) {
                DB::transaction(fn () => DB::table('funnel_diagnosis_issue')->where('issue_id', $issueId)->delete());
                throw new InvalidArgumentException('问题证据写入 ADB 失败，诊断任务未创建');
            }
        }

        return $this->formatIssueDetail(DB::table('funnel_diagnosis_issue')->where('issue_id', $issueId)->first());
    }

    /**
     * Update one issue with explicit lifecycle timestamps.
     */
    public function updateIssue(array $data, int|string|null $actorId): array
    {
        $issue = DB::table('funnel_diagnosis_issue')->where('issue_id', $data['issueId'])->first();
        if (!$issue) {
            throw new InvalidArgumentException('漏斗问题不存在');
        }

        $now = now();
        $updates = [
            'status' => $data['status'],
            'root_cause' => $data['rootCause'] ?? $issue->root_cause,
            'fix_plan' => $data['fixPlan'] ?? $issue->fix_plan,
            'owner_id' => $data['ownerId'] ?? $issue->owner_id,
            'target_version' => $data['targetVersion'] ?? $issue->target_version,
            'metric_code' => $data['metricCode'] ?? $issue->metric_code,
            'baseline_start_date' => $data['baselineStartDate'] ?? $issue->baseline_start_date,
            'baseline_end_date' => $data['baselineEndDate'] ?? $issue->baseline_end_date,
            'verify_start_date' => $data['verifyStartDate'] ?? $issue->verify_start_date,
            'verify_end_date' => $data['verifyEndDate'] ?? $issue->verify_end_date,
            'updated_by' => $actorId ? (string) $actorId : null,
            'updated_at' => $now,
        ];
        if ($data['status'] === 'FIXED' && !$issue->fixed_at) {
            $updates['fixed_at'] = $now;
        } elseif ($data['status'] === 'VERIFIED' && !$issue->verified_at) {
            $updates['verified_at'] = $now;
        } elseif ($data['status'] === 'CLOSED' && !$issue->closed_at) {
            $updates['closed_at'] = $now;
        }

        $calculationRow = (object) array_replace((array) $issue, $updates);
        $baselineMetric = $this->issueMetricForRecord($calculationRow, 'baseline');
        $verificationMetric = $this->issueMetricForRecord($calculationRow, 'verification');
        $updates['baseline_metric_value'] = $baselineMetric['available'] ? $baselineMetric['value'] : null;
        $updates['verify_metric_value'] = $verificationMetric['available'] ? $verificationMetric['value'] : null;

        if (in_array($data['status'], ['VERIFIED', 'CLOSED'], true) && !$verificationMetric['available']) {
            throw new InvalidArgumentException('当前验证区间没有可计算的 ADB 指标，不能标记为已验证或已关闭');
        }

        DB::transaction(
            fn () => DB::table('funnel_diagnosis_issue')->where('issue_id', $data['issueId'])->update($updates)
        );

        return $this->formatIssueDetail(DB::table('funnel_diagnosis_issue')->where('issue_id', $data['issueId'])->first());
    }

    /** Resolve an issue's project before an external employee is allowed to mutate it. */
    public function issueProjectCode(string $issueId): ?string
    {
        if (!Schema::hasTable('funnel_diagnosis_issue')) {
            return null;
        }

        $projectCode = DB::table('funnel_diagnosis_issue')
            ->where('issue_id', $issueId)
            ->value('project_code');

        return $projectCode !== null ? (string) $projectCode : null;
    }

    /**
     * Aggregate VPN operation metrics from the precomputed DWS table.
     */
    private function vpnSummaryAggregateQuery(array $params): Builder
    {
        $query = DB::connection('adb')->table('dws_vpn_connection_quality_daily')
            ->whereBetween('stat_date', [$params['dateFrom'], $params['dateTo']]);
        $this->whereBlank($query, 'phase_name');
        $this->whereBlank($query, 'protocol');
        $this->whereBlank($query, 'server_id');
        $this->applySummaryFilters($query, $params, 'dws_vpn_connection_quality_daily');

        return $query
            ->selectRaw('NULL AS app_name, MAX(app_identifier) AS app_identifier')
            ->selectRaw('SUM(dau_users) AS dau_users')
            ->selectRaw('SUM(vpn_users) AS connect_attempt_users')
            ->selectRaw('SUM(connection_success_count) AS connect_success_users')
            ->selectRaw('SUM(vpn_session_count) AS app_sessions')
            ->selectRaw('SUM(vpn_session_count) AS vpn_attempt_sessions')
            ->selectRaw('SUM(connection_result_count) AS vpn_connection_final_total')
            ->selectRaw('SUM(connection_success_count) AS vpn_connection_final_successful')
            ->selectRaw('SUM(post_connect_opportunity_users) AS post_connect_opportunity_users')
            ->selectRaw('SUM(post_connect_impression_users) AS post_connect_impression_users')
            ->selectRaw('SUM(post_connect_opportunity_count) AS opportunity_count')
            ->selectRaw('SUM(post_connect_impression_count) AS impression_count')
            ->selectRaw('SUM(connection_attempt_count) AS connect_attempt_count')
            ->selectRaw('SUM(connection_result_count) AS connect_result_count')
            ->selectRaw('SUM(connection_success_count) AS connect_success_count')
            ->selectRaw('SUM(connection_failed_count) AS connect_failed_count')
            ->selectRaw('SUM(permission_attempt_count) AS vpn_permission_attempt_count')
            ->selectRaw('SUM(permission_success_count) AS vpn_permission_success_count')
            ->selectRaw('SUM(node_selection_count) AS vpn_node_selection_count')
            ->selectRaw('SUM(valid_node_selection_count) AS vpn_valid_node_selection_count')
            ->selectRaw('SUM(tunnel_attempt_count) AS vpn_tunnel_attempt_count')
            ->selectRaw('SUM(tunnel_success_count) AS vpn_tunnel_success_count')
            ->selectRaw('SUM(connectivity_check_count) AS vpn_connectivity_check_count')
            ->selectRaw('SUM(connectivity_success_count) AS vpn_connectivity_success_count')
            ->selectRaw('SUM(protocol_fallback_count) AS fallback_attempt_count')
            ->selectRaw('SUM(protocol_fallback_recovered_count) AS fallback_success_count')
            ->selectRaw('SUM(network_switch_disconnect_count) AS vpn_network_switch_disconnect_count')
            ->selectRaw('SUM(auto_reconnect_count) AS reconnect_attempt_count')
            ->selectRaw('SUM(auto_reconnect_success_count) AS reconnect_success_count')
            ->selectRaw('SUM(ip_comparable_count) AS ip_comparable_count')
            ->selectRaw('SUM(ip_changed_count) AS ip_changed_count')
            ->selectRaw('SUM(country_changed_count) AS country_changed_count')
            ->selectRaw('SUM(asn_changed_count) AS asn_changed_count')
            ->selectRaw('MAX(duration_p95_ms) AS vpn_connect_p95_ms')
            ->selectRaw('MAX(computed_at) AS latest_event_at')
            ->selectRaw('MAX(computed_at) AS latest_loaded_at')
            ->selectRaw('SUM(api_event_count) AS api_event_count')
            ->selectRaw('SUM(firebase_event_count) AS firebase_event_count')
            ->selectRaw('SUM(both_source_event_count) AS both_source_event_count');
    }

    /**
     * Fill VPN user-level funnel steps from DWS stage aggregates when present.
     */
    private function withVpnSummaryStageCounts(object $row, array $params): object
    {
        try {
            $query = DB::connection('adb')->table('dws_app_funnel_stage_daily')
                ->whereBetween('stat_date', [$params['dateFrom'], $params['dateTo']])
                ->where('scope_type', 'users')
                ->where('funnel_code', 'like', 'vpn%');
            $this->applySummaryFilters($query, $params, 'dws_app_funnel_stage_daily');
            $stages = $query
                ->select('step_code')
                ->selectRaw('SUM(subject_count) AS subjects, SUM(event_count) AS events')
                ->groupBy('step_code')
                ->get()
                ->keyBy('step_code');
        } catch (Throwable $exception) {
            Log::warning('jkcl_vpn_summary_stage_counts_failed', [
                'message' => $exception->getMessage(),
                'projectCode' => $params['projectCode'] ?? null,
            ]);
            return $row;
        }

        foreach ([
            'dau' => 'dau_users',
            'home_entry' => 'vpn_home_entry_users',
            'connect_button_click' => 'vpn_connect_button_click_users',
            'permission_available' => 'vpn_permission_available_users',
            'permission_granted' => 'vpn_permission_available_users',
            'node_selected' => 'vpn_node_selected_users',
            'connect_attempt' => 'connect_attempt_users',
            'connect_success' => 'connect_success_users',
            'post_connect_opportunity' => 'post_connect_opportunity_users',
            'post_connect_impression' => 'post_connect_impression_users',
        ] as $stepCode => $field) {
            if ($stages->has($stepCode)) {
                $row->{$field} = (int) ($stages[$stepCode]->subjects ?? 0);
            }
        }

        return $row;
    }

    /**
     * Read VPN daily trend from DWS instead of rebuilding it from DWD.
     */
    private function vpnSummaryDailyTrend(array $params)
    {
        $query = DB::connection('adb')->table('dws_vpn_connection_quality_daily')
            ->whereBetween('stat_date', [$params['dateFrom'], $params['dateTo']]);
        $this->whereBlank($query, 'phase_name');
        $this->whereBlank($query, 'protocol');
        $this->whereBlank($query, 'server_id');
        $this->applySummaryFilters($query, $params, 'dws_vpn_connection_quality_daily');

        return $query
            ->selectRaw('stat_date AS event_date')
            ->selectRaw('SUM(dau_users) AS dau_users')
            ->selectRaw('SUM(vpn_users) AS connect_attempt_users')
            ->selectRaw('SUM(connection_success_count) AS connect_success_users')
            ->selectRaw('SUM(post_connect_opportunity_users) AS post_connect_opportunity_users')
            ->selectRaw('SUM(post_connect_impression_users) AS post_connect_impression_users')
            ->selectRaw('SUM(post_connect_opportunity_count) AS opportunity_count')
            ->selectRaw('SUM(post_connect_impression_count) AS impression_count')
            ->selectRaw('SUM(connection_attempt_count) AS connect_attempt_count')
            ->selectRaw('SUM(connection_success_count) AS connect_success_count')
            ->selectRaw('SUM(protocol_fallback_count) AS fallback_attempt_count')
            ->selectRaw('SUM(protocol_fallback_recovered_count) AS fallback_success_count')
            ->selectRaw('SUM(auto_reconnect_count) AS reconnect_attempt_count')
            ->selectRaw('SUM(auto_reconnect_success_count) AS reconnect_success_count')
            ->selectRaw('MAX(computed_at) AS latest_event_at')
            ->groupBy('stat_date')
            ->orderBy('stat_date')
            ->get()
            ->map(fn ($dailyRow) => ['date' => $dailyRow->event_date] + $this->formatSummary($dailyRow));
    }

    private function summaryScreens(array $params)
    {
        try {
            $query = DB::connection('adb')->table('dws_screen_path_daily')
                ->whereBetween('stat_date', [$params['dateFrom'], $params['dateTo']]);
            $this->applySummaryFilters($query, $params, 'dws_screen_path_daily');

            return $query
                ->whereNotNull('start_screen')
                ->where('start_screen', '!=', '')
                ->selectRaw('start_screen AS screen_name')
                ->selectRaw('SUM(screen_view_count) AS events')
                ->selectRaw('SUM(user_count) AS users')
                ->groupBy('start_screen')
                ->orderByDesc('events')
                ->limit(20)
                ->get();
        } catch (Throwable $exception) {
            Log::warning('jkcl_summary_screens_failed', ['message' => $exception->getMessage()]);
            return collect();
        }
    }

    private function summaryQualityFromDws(array $params): array
    {
        try {
            $query = DB::connection('adb')->table('dws_app_event_quality_daily')
                ->whereBetween('stat_date', [$params['dateFrom'], $params['dateTo']]);
            $this->applySummaryFilters($query, $params, 'dws_app_event_quality_daily');
            $row = $query
                ->selectRaw('SUM(total_event_count) AS observed_events')
                ->selectRaw('SUM(accepted_event_count) AS accepted_events')
                ->selectRaw('SUM(api_event_count) AS api_events')
                ->selectRaw('SUM(firebase_event_count) AS firebase_events')
                ->selectRaw('SUM(duplicate_count) AS duplicate_events')
                ->selectRaw('SUM(conflict_count + quarantine_count + unknown_event_count + missing_event_id_count + invalid_event_id_count + type_mismatch_count) AS warning_events')
                ->selectRaw('SUM(orphan_opportunity_count) AS orphan_opportunity_events')
                ->selectRaw('SUM(orphan_request_count) AS orphan_request_events')
                ->selectRaw('SUM(orphan_instance_count) AS orphan_ad_instance_events')
                ->selectRaw('SUM(orphan_session_count + orphan_decision_count + orphan_opportunity_count + orphan_request_count + orphan_instance_count + orphan_vpn_session_count + orphan_connection_count) AS orphan_link_events')
                ->selectRaw('SUM(association_required_count) AS required_link_events')
                ->selectRaw('SUM(association_complete_count) AS association_complete_events')
                ->selectRaw('SUM(p0_field_total) AS p0_field_total')
                ->selectRaw('SUM(p0_field_present) AS p0_field_present')
                ->selectRaw('SUM(p1_field_total) AS p1_field_total')
                ->selectRaw('SUM(p1_field_present) AS p1_field_present')
                ->selectRaw('AVG(receive_delay_avg_ms) AS avg_receive_delay_ms')
                ->selectRaw('MAX(receive_delay_p95_ms) AS receive_delay_p95_ms')
                ->selectRaw('MAX(computed_at) AS latest_loaded_at')
                ->first();
        } catch (Throwable $exception) {
            Log::warning('jkcl_summary_quality_failed', ['message' => $exception->getMessage()]);
            return $this->emptySummaryQuality('质量汇总读取失败');
        }

        $acceptedEvents = (int) ($row->accepted_events ?? 0);
        $observedEvents = (int) ($row->observed_events ?? 0);
        $warningEvents = (int) ($row->warning_events ?? 0);
        $requiredLinkEvents = (int) ($row->required_link_events ?? 0);
        $associationComplete = (int) ($row->association_complete_events ?? 0);

        return [
            'totalEvents' => $observedEvents,
            'acceptedEvents' => $acceptedEvents,
            'observedEvents' => $observedEvents,
            'apiEvents' => (int) ($row->api_events ?? 0),
            'firebaseEvents' => (int) ($row->firebase_events ?? 0),
            'warningEvents' => $warningEvents,
            'acceptedWarningEvents' => $warningEvents,
            'quarantineEvents' => 0,
            'quarantineAvailable' => true,
            'quarantineUnavailableReason' => null,
            'quarantineReasons' => [],
            'orphanOpportunityEvents' => (int) ($row->orphan_opportunity_events ?? 0),
            'orphanRequestEvents' => (int) ($row->orphan_request_events ?? 0),
            'orphanAdInstanceEvents' => (int) ($row->orphan_ad_instance_events ?? 0),
            'requiredLinkEvents' => $requiredLinkEvents,
            'orphanLinkEvents' => max(0, $requiredLinkEvents - $associationComplete),
            'associationCompleteEvents' => $associationComplete,
            'p0FieldTotal' => (int) ($row->p0_field_total ?? 0),
            'p0FieldPresent' => (int) ($row->p0_field_present ?? 0),
            'p1FieldTotal' => (int) ($row->p1_field_total ?? 0),
            'p1FieldPresent' => (int) ($row->p1_field_present ?? 0),
            'averageReceiveDelayMs' => $row->avg_receive_delay_ms !== null ? round((float) $row->avg_receive_delay_ms) : null,
            'receiveDelayP95Ms' => $row->receive_delay_p95_ms !== null ? (int) $row->receive_delay_p95_ms : null,
            'latestLoadedAt' => $row->latest_loaded_at ?? null,
            'source' => 'dws_app_event_quality_daily',
        ];
    }

    private function emptySummaryQuality(?string $reason = null): array
    {
        return [
            'totalEvents' => 0,
            'acceptedEvents' => 0,
            'observedEvents' => 0,
            'apiEvents' => 0,
            'firebaseEvents' => 0,
            'warningEvents' => 0,
            'acceptedWarningEvents' => 0,
            'quarantineEvents' => 0,
            'quarantineAvailable' => $reason === null,
            'quarantineUnavailableReason' => $reason,
            'quarantineReasons' => [],
            'orphanOpportunityEvents' => 0,
            'orphanRequestEvents' => 0,
            'orphanAdInstanceEvents' => 0,
            'requiredLinkEvents' => 0,
            'orphanLinkEvents' => 0,
            'associationCompleteEvents' => 0,
            'p0FieldTotal' => 0,
            'p0FieldPresent' => 0,
            'p1FieldTotal' => 0,
            'p1FieldPresent' => 0,
            'averageReceiveDelayMs' => null,
            'receiveDelayP95Ms' => null,
            'latestLoadedAt' => null,
            'source' => 'dws_app_event_quality_daily',
        ];
    }

    private function summaryQualityGatesFromQuality(array $quality): array
    {
        $requiredLinkEvents = (int) ($quality['requiredLinkEvents'] ?? 0);
        $orphanEvents = (int) ($quality['orphanLinkEvents'] ?? 0);
        $p0Total = (int) ($quality['p0FieldTotal'] ?? 0);
        $p0Present = (int) ($quality['p0FieldPresent'] ?? 0);
        $acceptedEvents = (int) ($quality['acceptedEvents'] ?? 0);
        $unknownRate = $acceptedEvents > 0
            ? $this->rate((int) ($quality['warningEvents'] ?? 0), $acceptedEvents)
            : null;
        $associationRate = $requiredLinkEvents > 0
            ? $this->rate(max(0, $requiredLinkEvents - $orphanEvents), $requiredLinkEvents)
            : null;
        $p0Rate = $p0Total > 0 ? $this->rate($p0Present, $p0Total) : null;

        return [
            [
                'key' => 'p0_event_completeness',
                'label' => 'P0事件完整率',
                'value' => null,
                'unit' => 'ratio',
                'target' => '目标 100%',
                'available' => false,
                'passed' => false,
                'rule' => '汇总快路径不扫描 P0 事件清单；如需逐事件核验，请进入打点验证中心。',
            ],
            [
                'key' => 'p0_parameter_completeness',
                'label' => 'P0参数完整率',
                'value' => $p0Rate,
                'unit' => 'ratio',
                'target' => '目标 100%',
                'available' => $p0Rate !== null,
                'passed' => $p0Rate !== null && $p0Rate >= 100,
                'rule' => $p0Rate === null ? '当前切片没有 P0 参数样本' : sprintf('P0 参数已出现 %d / %d', $p0Present, $p0Total),
            ],
            [
                'key' => 'association_integrity',
                'label' => '关键ID完整率',
                'value' => $associationRate,
                'unit' => 'ratio',
                'target' => '目标 100%',
                'available' => $associationRate !== null,
                'passed' => $associationRate !== null && $associationRate >= 100,
                'rule' => '来自 dws_app_event_quality_daily.association_required_count / association_complete_count',
            ],
            [
                'key' => 'unknown_rate',
                'label' => '异常/隔离率',
                'value' => $unknownRate,
                'unit' => 'ratio',
                'target' => '目标 < 1%',
                'available' => $unknownRate !== null,
                'passed' => $unknownRate !== null && $unknownRate < 1,
                'rule' => '质量异常事件 / accepted_event_count',
            ],
        ];
    }

    private function summaryVpnStageHealth(array $params, ?array $comparisonParams = null): array
    {
        $stages = $this->summaryVpnStageRows($params);
        $comparisonByKey = $comparisonParams
            ? collect($this->summaryVpnStageRows($comparisonParams))->keyBy('stageKey')
            : collect();

        return [
            'source' => 'dws_vpn_connection_quality_daily',
            'stages' => collect($stages)->map(function (array $stage) use ($comparisonByKey): array {
                $baseline = $comparisonByKey->get($stage['stageKey']);
                $delta = $baseline && $stage['successRate'] !== null && $baseline['successRate'] !== null
                    ? round($stage['successRate'] - $baseline['successRate'], 2)
                    : null;

                return $stage + [
                    'baselineDelta' => $delta,
                    'displayBaselineDelta' => $delta === null
                        ? '暂无基线'
                        : (($delta > 0 ? '+' : '') . number_format($delta, 2) . 'pp'),
                ];
            })->values()->all(),
            'strip' => [],
        ];
    }

    private function summaryVpnStageRows(array $params): array
    {
        try {
            $query = DB::connection('adb')->table('dws_vpn_connection_quality_daily')
                ->whereBetween('stat_date', [$params['dateFrom'], $params['dateTo']])
                ->whereNotNull('phase_name')
                ->where('phase_name', '!=', '');
            $this->applySummaryFilters($query, $params, 'dws_vpn_connection_quality_daily');

            return $query
                ->selectRaw('phase_name')
                ->selectRaw('SUM(phase_attempt_count) AS attempts')
                ->selectRaw('SUM(phase_success_count) AS successes')
                ->selectRaw('MAX(duration_p95_ms) AS p95_ms')
                ->groupBy('phase_name')
                ->orderByDesc('attempts')
                ->get()
                ->map(function ($row): array {
                    $attempts = (int) ($row->attempts ?? 0);
                    $successes = (int) ($row->successes ?? 0);
                    $p95 = $row->p95_ms === null ? null : (int) $row->p95_ms;
                    $rate = $attempts > 0 ? $this->rate($successes, $attempts) : null;
                    $phaseName = (string) ($row->phase_name ?? '');

                    return [
                        'stageKey' => $phaseName,
                        'stageName' => $this->vpnPhaseDisplayName($phaseName),
                        'eventName' => 'vpn_connection_phase · ' . $phaseName,
                        'successCount' => $successes,
                        'totalCount' => $attempts,
                        'displaySuccessCount' => $attempts > 0 ? number_format($successes) : '暂无数据',
                        'successRate' => $rate,
                        'displaySuccessRate' => $rate === null ? '暂无数据' : number_format($rate, 2) . '%',
                        'p95Ms' => $p95,
                        'displayP95' => $p95 === null ? '暂无数据' : $this->formatDuration($p95),
                        'status' => $this->vpnStageStatus($rate, $p95),
                        'available' => $attempts > 0,
                        'evidenceKeyword' => $phaseName,
                    ];
                })
                ->values()
                ->all();
        } catch (Throwable $exception) {
            Log::warning('jkcl_summary_vpn_stage_rows_failed', ['message' => $exception->getMessage()]);
            return [];
        }
    }

    private function summaryVpnSupplementalPanels(object $row, array $dailyTrend, array $qualityGates): array
    {
        $ipComparable = (int) ($row->ip_comparable_count ?? 0);

        return [
            'networkChanges' => [
                [
                    'key' => 'ip_change',
                    'label' => 'IP变化',
                    'value' => $ipComparable > 0 ? number_format($this->rate((int) ($row->ip_changed_count ?? 0), $ipComparable), 2) . '%' : '暂无数据',
                    'detail' => number_format((int) ($row->ip_changed_count ?? 0)) . ' / ' . number_format($ipComparable),
                    'available' => $ipComparable > 0,
                    'status' => 'unrated',
                ],
                [
                    'key' => 'country_change',
                    'label' => '国家变化',
                    'value' => $ipComparable > 0 ? number_format($this->rate((int) ($row->country_changed_count ?? 0), $ipComparable), 2) . '%' : '暂无数据',
                    'detail' => number_format((int) ($row->country_changed_count ?? 0)) . ' / ' . number_format($ipComparable),
                    'available' => $ipComparable > 0,
                    'status' => 'unrated',
                ],
                [
                    'key' => 'asn_change',
                    'label' => 'ASN变化',
                    'value' => $ipComparable > 0 ? number_format($this->rate((int) ($row->asn_changed_count ?? 0), $ipComparable), 2) . '%' : '暂无数据',
                    'detail' => number_format((int) ($row->asn_changed_count ?? 0)) . ' / ' . number_format($ipComparable),
                    'available' => $ipComparable > 0,
                    'status' => 'unrated',
                ],
            ],
            'protocolNodeRanking' => $this->summaryVpnProtocolNodeRanking($row),
            'trend' => $this->vpnTrend($dailyTrend),
            'technicalChecks' => collect($qualityGates)->map(fn ($gate) => [
                'key' => $gate['key'] ?? 'quality_gate',
                'title' => $gate['label'] ?? '质量门禁',
                'description' => $gate['rule'] ?? '来自 DWS 汇总质量门禁',
                'status' => !($gate['available'] ?? false) ? 'unavailable' : (($gate['passed'] ?? false) ? 'good' : 'warn'),
                'available' => (bool) ($gate['available'] ?? false),
            ])->values()->all(),
        ];
    }

    private function summaryVpnProtocolNodeRanking(object $row): array
    {
        $attempts = (int) ($row->connect_attempt_count ?? 0);
        $successes = (int) ($row->connect_success_count ?? 0);

        return [[
            'key' => 'overall',
            'protocol' => '整体',
            'serverId' => '全部节点',
            'attempts' => $attempts,
            'successes' => $successes,
            'successRate' => $this->rate($successes, $attempts),
            'p95Ms' => ($row->vpn_connect_p95_ms ?? null) === null ? null : (int) $row->vpn_connect_p95_ms,
            'status' => 'unrated',
        ]];
    }

    private function summaryVpnFailureReasons(array $params)
    {
        return collect();
    }

    private function summaryFreshnessFromAggregate(object $aggregate): array
    {
        $coreRows = (int) (($aggregate->api_event_count ?? 0) + ($aggregate->firebase_event_count ?? 0));
        $coreFirebaseRows = (int) ($aggregate->firebase_event_count ?? 0);
        $coreReconciledRows = (int) ($aggregate->both_source_event_count ?? 0);
        $calibrationStatus = match (true) {
            $coreRows === 0 => 'unavailable',
            $coreReconciledRows >= $coreRows => 'calibrated',
            $coreFirebaseRows >= $coreRows => 'firebase',
            $coreFirebaseRows > 0 => 'partial',
            default => 'realtime',
        };

        return [
            'latestEventAt' => $aggregate->latest_event_at ?? null,
            'latestLoadedAt' => $aggregate->latest_loaded_at ?? null,
            'realtimeRows' => 0,
            'verifiedRows' => $coreRows,
            'firebaseRows' => $coreFirebaseRows,
            'apiRows' => (int) ($aggregate->api_event_count ?? 0),
            'reconciledRows' => $coreReconciledRows,
            'coreRows' => $coreRows,
            'coreFirebaseRows' => $coreFirebaseRows,
            'coreReconciledRows' => $coreReconciledRows,
            'calibrationStatus' => $calibrationStatus,
            'source' => 'dws_summary',
        ];
    }

    private function vpnPhaseDisplayName(string $phaseName): string
    {
        return [
            'ready' => '准备连接',
            'dns_resolve' => 'DNS解析',
            'socket_connect' => 'Socket连接',
            'protocol_handshake' => '协议握手',
            'tunnel_create' => '隧道创建',
            'connectivity_check' => '出口可用性',
        ][$phaseName] ?? $phaseName;
    }

    private function applySummaryFilters(Builder $query, array $params, string $table): void
    {
        $tableColumns = [
            'dws_vpn_connection_quality_daily' => ['project_code', 'app_identifier', 'platform', 'country_code', 'app_version', 'build_number', 'network_type', 'protocol', 'server_id'],
            'dws_app_event_quality_daily' => ['project_code', 'app_identifier', 'platform', 'country_code', 'app_version', 'build_number', 'event_name', 'schema_version'],
            'dws_screen_path_daily' => ['project_code', 'app_identifier', 'platform', 'country_code', 'app_version', 'build_number', 'network_type'],
            'dws_app_funnel_stage_daily' => ['project_code', 'app_identifier', 'platform', 'country_code', 'app_version', 'build_number', 'network_type', 'placement', 'ad_format', 'ad_source', 'protocol', 'server_id'],
        ];
        $availableColumns = $tableColumns[$table] ?? [];

        foreach ([
            'projectCode' => 'project_code',
            'appIdentifier' => 'app_identifier',
            'country' => 'country_code',
            'appVersion' => 'app_version',
            'buildNumber' => 'build_number',
            'networkType' => 'network_type',
            'placement' => 'placement',
            'adFormat' => 'ad_format',
            'adSource' => 'ad_source',
            'protocol' => 'protocol',
            'serverId' => 'server_id',
        ] as $key => $column) {
            if (!empty($params[$key]) && in_array($column, $availableColumns, true) && !$this->isAllSummaryFilterValue((string) $params[$key])) {
                $query->where($column, $this->summaryFilterValue($key, (string) $params[$key]));
            }
        }

        if (empty($params['projectCode']) && !empty($params['projectCodes'])) {
            $query->whereIn('project_code', $params['projectCodes']);
        }
    }

    private function summaryFilterValue(string $key, string $value): string
    {
        $trimmed = trim($value);
        return in_array($key, ['platform', 'country'], true) ? strtolower($trimmed) : $trimmed;
    }

    private function isAllSummaryFilterValue(string $value): bool
    {
        return in_array(strtolower(trim($value)), ['', 'all', '全部', '全部国家', '全部平台', '全部版本'], true);
    }

    private function whereBlank(Builder $query, string $column): void
    {
        $query->where(function (Builder $inner) use ($column): void {
            $inner->whereNull($column)->orWhere($column, '=', '');
        });
    }

    private function aggregateQuery(array $params): Builder
    {
        return $this->aggregateBaseQuery($params)
            ->selectRaw($this->aggregateSelect());
    }

    /**
     * Build the common event query with the request and instance relationships
     * required by preload and cache-waste aggregate formulas.
     */
    private function aggregateBaseQuery(array $params): Builder
    {
        $table = $this->eventTable();
        $contextParams = array_replace($params, [
            'dateFrom' => Carbon::parse($params['dateFrom'])->subDay()->toDateString(),
            'eventModule' => null,
        ]);
        $preloadRequests = $this->baseQuery($params)
            ->selectRaw('event_date AS preload_event_date')
            ->selectRaw('project_code AS preload_project_code')
            ->selectRaw('app_identifier AS preload_app_identifier')
            ->selectRaw('platform AS preload_platform')
            ->selectRaw('request_id AS preload_request_id')
            ->where('event_name', 'ad_request')
            ->where('is_preload', true)
            ->whereNotNull('request_id')
            ->where('request_id', '!=', '')
            ->groupBy('event_date', 'project_code', 'app_identifier', 'platform', 'request_id');
        $impressionInstances = $this->baseQuery($params)
            ->selectRaw('event_date AS impression_event_date')
            ->selectRaw('project_code AS impression_project_code')
            ->selectRaw('app_identifier AS impression_app_identifier')
            ->selectRaw('platform AS impression_platform')
            ->selectRaw('ad_instance_id AS impression_instance_id')
            ->where('event_name', 'ad_impression')
            ->whereNotNull('ad_instance_id')
            ->where('ad_instance_id', '!=', '')
            ->groupBy('event_date', 'project_code', 'app_identifier', 'platform', 'ad_instance_id');
        $cacheMissOpportunities = $this->baseQuery($params)
            ->selectRaw('event_date AS miss_event_date')
            ->selectRaw('project_code AS miss_project_code')
            ->selectRaw('app_identifier AS miss_app_identifier')
            ->selectRaw('platform AS miss_platform')
            ->selectRaw('opportunity_id AS miss_opportunity_id')
            ->where('event_name', 'ad_cache_miss')
            ->whereNotNull('opportunity_id')
            ->where('opportunity_id', '!=', '')
            ->groupBy('event_date', 'project_code', 'app_identifier', 'platform', 'opportunity_id');
        $successfulVpnUsers = $this->baseQuery($contextParams)
            ->selectRaw('project_code AS vpn_project_code')
            ->selectRaw('app_identifier AS vpn_app_identifier')
            ->selectRaw('my_user_id AS vpn_user_id')
            ->selectRaw('session_id AS vpn_app_session_id')
            ->selectRaw('MIN(event_time_utc) AS first_success_at')
            ->where('event_name', 'vpn_connection_result')
            ->whereRaw("LOWER(COALESCE(result_status, '')) = 'success'")
            ->whereNotNull('my_user_id')
            ->where('my_user_id', '!=', '')
            ->whereNotNull('session_id')
            ->where('session_id', '!=', '')
            ->groupBy('project_code', 'app_identifier', 'my_user_id', 'session_id');
        $fallbackSessions = $this->baseQuery($contextParams)
            ->selectRaw('project_code AS fallback_project_code')
            ->selectRaw('app_identifier AS fallback_app_identifier')
            ->selectRaw('vpn_session_id AS fallback_vpn_session_id')
            ->selectRaw('MIN(event_time_utc) AS first_fallback_at')
            ->where('event_name', 'vpn_protocol_fallback')
            ->whereNotNull('vpn_session_id')
            ->where('vpn_session_id', '!=', '')
            ->groupBy('project_code', 'app_identifier', 'vpn_session_id');
        $autoReconnectStarts = $this->baseQuery($contextParams)
            ->selectRaw('project_code AS reconnect_project_code')
            ->selectRaw('app_identifier AS reconnect_app_identifier')
            ->selectRaw('connection_id AS reconnect_connection_id')
            ->selectRaw('MIN(event_time_utc) AS first_reconnect_at')
            ->where('event_name', 'vpn_connection_start')
            ->whereRaw("LOWER(COALESCE(trigger_type, '')) = 'auto_reconnect'")
            ->whereNotNull('connection_id')
            ->where('connection_id', '!=', '')
            ->groupBy('project_code', 'app_identifier', 'connection_id');

        return $this->baseQuery($params)
            ->leftJoinSub($preloadRequests, 'preload_requests', function ($join) use ($table): void {
                $join->on('preload_requests.preload_event_date', '=', $table . '.event_date')
                    ->on('preload_requests.preload_project_code', '=', $table . '.project_code')
                    ->on('preload_requests.preload_app_identifier', '=', $table . '.app_identifier')
                    ->on('preload_requests.preload_platform', '=', $table . '.platform')
                    ->on('preload_requests.preload_request_id', '=', $table . '.request_id');
            })
            ->leftJoinSub($impressionInstances, 'impression_instances', function ($join) use ($table): void {
                $join->on('impression_instances.impression_event_date', '=', $table . '.event_date')
                    ->on('impression_instances.impression_project_code', '=', $table . '.project_code')
                    ->on('impression_instances.impression_app_identifier', '=', $table . '.app_identifier')
                    ->on('impression_instances.impression_platform', '=', $table . '.platform')
                    ->on('impression_instances.impression_instance_id', '=', $table . '.ad_instance_id');
            })
            ->leftJoinSub($cacheMissOpportunities, 'cache_miss_opportunities', function ($join) use ($table): void {
                $join->on('cache_miss_opportunities.miss_event_date', '=', $table . '.event_date')
                    ->on('cache_miss_opportunities.miss_project_code', '=', $table . '.project_code')
                    ->on('cache_miss_opportunities.miss_app_identifier', '=', $table . '.app_identifier')
                    ->on('cache_miss_opportunities.miss_platform', '=', $table . '.platform')
                    ->on('cache_miss_opportunities.miss_opportunity_id', '=', $table . '.opportunity_id');
            })
            ->leftJoinSub($successfulVpnUsers, 'vpn_success_users', function ($join) use ($table): void {
                $join->on('vpn_success_users.vpn_project_code', '=', $table . '.project_code')
                    ->on('vpn_success_users.vpn_app_identifier', '=', $table . '.app_identifier')
                    ->on('vpn_success_users.vpn_user_id', '=', $table . '.my_user_id')
                    ->on('vpn_success_users.vpn_app_session_id', '=', $table . '.session_id');
            })
            ->leftJoinSub($fallbackSessions, 'fallback_sessions', function ($join) use ($table): void {
                $join->on('fallback_sessions.fallback_project_code', '=', $table . '.project_code')
                    ->on('fallback_sessions.fallback_app_identifier', '=', $table . '.app_identifier')
                    ->on('fallback_sessions.fallback_vpn_session_id', '=', $table . '.vpn_session_id');
            })
            ->leftJoinSub($autoReconnectStarts, 'auto_reconnect_starts', function ($join) use ($table): void {
                $join->on('auto_reconnect_starts.reconnect_project_code', '=', $table . '.project_code')
                    ->on('auto_reconnect_starts.reconnect_app_identifier', '=', $table . '.app_identifier')
                    ->on('auto_reconnect_starts.reconnect_connection_id', '=', $table . '.connection_id');
            });
    }

    private function aggregateSelect(): string
    {
        return implode(', ', [
            "COUNT(DISTINCT CASE WHEN event_name = 'app_foreground' THEN NULLIF(my_user_id, '') END) AS dau_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_eligibility_check' THEN NULLIF(my_user_id, '') END) AS eligibility_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_eligibility_check' AND eligible = 1 THEN NULLIF(my_user_id, '') END) AS eligible_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_opportunity' THEN NULLIF(my_user_id, '') END) AS opportunity_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_request' THEN NULLIF(my_user_id, '') END) AS request_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_request' AND COALESCE(is_preload, 0) = 0 THEN NULLIF(my_user_id, '') END) AS realtime_request_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_request' AND is_preload = 1 THEN NULLIF(my_user_id, '') END) AS preload_request_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_show_attempt' THEN NULLIF(my_user_id, '') END) AS show_attempt_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_impression' THEN NULLIF(my_user_id, '') END) AS impression_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_paid_event' THEN NULLIF(my_user_id, '') END) AS paid_users",
            "SUM(CASE WHEN event_name = 'ad_opportunity' THEN 1 ELSE 0 END) AS opportunity_count",
            "SUM(CASE WHEN event_name = 'ad_preload_trigger' THEN 1 ELSE 0 END) AS preload_trigger_count",
            "SUM(CASE WHEN event_name = 'ad_request' THEN 1 ELSE 0 END) AS request_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_request' THEN request_id END) AS request_id_count",
            "SUM(CASE WHEN event_name IN ('ad_request_accepted', 'request_accepted_derived') THEN 1 ELSE 0 END) AS request_accepted_count",
            "SUM(CASE WHEN event_name = 'ad_load_success' THEN 1 ELSE 0 END) AS load_success_count",
            "SUM(CASE WHEN event_name = 'ad_load_failed' THEN 1 ELSE 0 END) AS load_failed_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_load_success' THEN request_id END) AS load_success_request_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_load_failed' THEN request_id END) AS load_failed_request_count",
            "COUNT(DISTINCT CASE WHEN event_name IN ('ad_load_success', 'ad_load_failed') THEN request_id END) AS load_terminal_request_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_cache_hit' THEN opportunity_id END) AS cache_hit_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_cache_miss' THEN opportunity_id END) AS cache_miss_count",
            "SUM(CASE WHEN event_name = 'ad_cache_put' THEN 1 ELSE 0 END) AS cache_put_count",
            "SUM(CASE WHEN event_name = 'ad_cache_take' THEN 1 ELSE 0 END) AS cache_take_count",
            "SUM(CASE WHEN event_name = 'ad_cache_expired' THEN 1 ELSE 0 END) AS cache_expired_count",
            "SUM(CASE WHEN event_name = 'ad_cache_discard' THEN 1 ELSE 0 END) AS cache_discard_count",
            "SUM(CASE WHEN event_name = 'ad_request' AND COALESCE(is_preload, 0) = 0 THEN 1 ELSE 0 END) AS realtime_request_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_request' AND COALESCE(is_preload, 0) = 0 AND cache_miss_opportunities.miss_opportunity_id IS NOT NULL THEN request_id END) AS realtime_request_after_miss_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_request' AND COALESCE(is_preload, 0) = 0 AND cache_miss_opportunities.miss_opportunity_id IS NOT NULL THEN opportunity_id END) AS cache_miss_with_request_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_request' AND is_preload = 1 THEN request_id END) AS preload_request_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_load_success' AND preload_requests.preload_request_id IS NOT NULL THEN request_id END) AS preload_success_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_cache_put' AND preload_requests.preload_request_id IS NOT NULL THEN request_id END) AS preload_cache_store_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_ready' AND preload_requests.preload_request_id IS NOT NULL THEN request_id END) AS preload_ready_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_load_success' THEN ad_instance_id END) AS load_success_instance_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_load_success' AND ad_instance_id IS NOT NULL AND ad_instance_id != '' AND impression_instances.impression_instance_id IS NULL THEN ad_instance_id END) AS load_success_without_impression_instance_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_cache_discard' AND impression_instances.impression_instance_id IS NULL THEN ad_instance_id END) AS unshown_discard_instance_count",
            "SUM(CASE WHEN event_name = 'ad_show_attempt' THEN 1 ELSE 0 END) AS show_attempt_count",
            "SUM(CASE WHEN event_name = 'ad_show_success' THEN 1 ELSE 0 END) AS show_success_count",
            "SUM(CASE WHEN event_name = 'ad_show_failed' THEN 1 ELSE 0 END) AS show_failed_count",
            "SUM(CASE WHEN event_name = 'ad_show_blocked' THEN 1 ELSE 0 END) AS show_blocked_count",
            "SUM(CASE WHEN event_name = 'ad_ready' THEN 1 ELSE 0 END) AS ad_ready_count",
            "SUM(CASE WHEN event_name = 'ad_impression' THEN 1 ELSE 0 END) AS impression_count",
            "SUM(CASE WHEN event_name = 'ad_paid_event' THEN 1 ELSE 0 END) AS paid_event_count",
            "SUM(CASE WHEN event_name = 'ad_paid_event' THEN COALESCE(value_micros, 0) ELSE 0 END) AS revenue_micros",
            "COUNT(DISTINCT CASE WHEN event_name = 'vpn_connection_start' THEN NULLIF(my_user_id, '') END) AS connect_attempt_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'vpn_connection_result' AND LOWER(COALESCE(result_status, '')) = 'success' THEN NULLIF(my_user_id, '') END) AS connect_success_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_opportunity' AND vpn_success_users.first_success_at IS NOT NULL AND event_time_utc >= vpn_success_users.first_success_at THEN NULLIF(my_user_id, '') END) AS post_connect_opportunity_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'ad_impression' AND vpn_success_users.first_success_at IS NOT NULL AND event_time_utc >= vpn_success_users.first_success_at THEN NULLIF(my_user_id, '') END) AS post_connect_impression_users",
            "COUNT(DISTINCT CASE WHEN event_name = 'vpn_connection_start' THEN NULLIF(connection_id, '') END) AS connect_attempt_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'vpn_connection_result' AND LOWER(COALESCE(result_status, '')) = 'success' THEN NULLIF(connection_id, '') END) AS connect_success_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'vpn_protocol_fallback' THEN NULLIF(vpn_session_id, '') END) AS fallback_attempt_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'vpn_connection_result' AND LOWER(COALESCE(result_status, '')) = 'success' AND fallback_sessions.first_fallback_at IS NOT NULL AND event_time_utc >= fallback_sessions.first_fallback_at THEN NULLIF(vpn_session_id, '') END) AS fallback_success_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'vpn_connection_start' AND LOWER(COALESCE(trigger_type, '')) = 'auto_reconnect' THEN NULLIF(connection_id, '') END) AS reconnect_attempt_count",
            "COUNT(DISTINCT CASE WHEN event_name = 'vpn_connection_result' AND LOWER(COALESCE(result_status, '')) = 'success' AND auto_reconnect_starts.first_reconnect_at IS NOT NULL AND event_time_utc >= auto_reconnect_starts.first_reconnect_at THEN NULLIF(connection_id, '') END) AS reconnect_success_count",
            "MAX(event_time_utc) AS latest_event_at",
        ]);
    }

    private function baseQuery(array $params): Builder
    {
        $query = DB::connection('adb')->table($this->eventTable())
            ->whereBetween('event_date', [$params['dateFrom'], $params['dateTo']]);
        foreach (['projectCode' => 'project_code', 'appIdentifier' => 'app_identifier', 'platform' => 'platform', 'country' => 'country_code', 'appVersion' => 'app_version', 'buildNumber' => 'app_build', 'networkType' => 'network_type', 'placement' => 'placement', 'adFormat' => 'ad_format', 'adSource' => 'ad_source', 'qualityStatus' => 'quality_status', 'eventModule' => 'event_module'] as $key => $column) {
            if (!empty($params[$key])) {
                $query->where($column, $params[$key]);
            }
        }
        if (empty($params['projectCode']) && !empty($params['projectCodes'])) {
            $query->whereIn('project_code', $params['projectCodes']);
        }
        if (!empty($params['sourceType'])) {
            match ($params['sourceType']) {
                'api' => $query->where('api_seen', true),
                'firebase' => $query->where('firebase_seen', true),
                'both' => $query->where('api_seen', true)->where('firebase_seen', true),
            };
        }

        return $query;
    }

    /**
     * Resolve the real previous date window used by metric comparison cards.
     */
    private function comparisonParams(array $params): ?array
    {
        $type = $params['compareType'] ?? 'yesterday_same_period';
        if ($type === 'none') {
            return null;
        }

        $dateFrom = Carbon::parse($params['dateFrom']);
        $dateTo = Carbon::parse($params['dateTo']);
        $rangeDays = $dateFrom->diffInDays($dateTo) + 1;
        $shiftDays = $type === 'previous_period' ? $rangeDays : 1;

        return array_replace($params, [
            'dateFrom' => $dateFrom->copy()->subDays($shiftDays)->toDateString(),
            'dateTo' => $dateTo->copy()->subDays($shiftDays)->toDateString(),
        ]);
    }

    /**
     * Attach a same-formula baseline to every metric without changing existing fields.
     */
    private function attachMetricComparison(array $metrics, array $comparisonMetrics, bool $available): array
    {
        $comparisonByKey = collect($comparisonMetrics)->keyBy('metricKey');

        return collect($metrics)->map(function (array $metric) use ($comparisonByKey, $available): array {
            $baseline = $comparisonByKey->get($metric['metricKey']);
            if (!$available
                || !$baseline
                || ($metric['available'] ?? true) === false
                || ($baseline['available'] ?? true) === false
            ) {
                return $metric + [
                    'baselineValue' => null,
                    'delta' => null,
                    'deltaPp' => null,
                ];
            }

            $delta = round((float) $metric['value'] - (float) $baseline['value'], 2);

            return $metric + [
                'baselineValue' => (float) $baseline['value'],
                'delta' => $delta,
                'deltaPp' => $metric['unit'] === 'ratio' ? $delta : null,
            ];
        })->values()->all();
    }

    /**
     * Aggregate controlled failure reasons for both core diagnostics and drill-down.
     */
    private function failureReasons(array $params)
    {
        return $this->baseQuery($params)
            ->where(function (Builder $query): void {
                $query->whereNotNull('blocked_reason')
                    ->orWhereNotNull('error_category')
                    ->orWhereNotNull('cache_reason');
            })
            ->selectRaw("COALESCE(NULLIF(blocked_reason, ''), NULLIF(error_category, ''), NULLIF(cache_reason, ''), 'unknown') AS reason")
            ->selectRaw('COUNT(*) AS events, COUNT(DISTINCT my_user_id) AS users')
            ->groupBy('reason')
            ->orderByDesc('events')
            ->limit(20)
            ->get();
    }

    /**
     * Cross table for ad delivery failures under VPN/network dimensions.
     *
     * Ad fulfillment DWS does not contain ASN/node/protocol. Until ETL produces
     * a dedicated DWS matrix, build this report from V1.8 detail events and
     * protect it with the same historical-date cache rule used by the VPN page.
     */
    private function adNetworkFailureMatrix(array $params): array
    {
        $cacheKey = 'jkcl_funnel:ad_network_failure_matrix:v2:' . md5(json_encode(
            $this->sortForCacheKey($params),
            JSON_UNESCAPED_UNICODE
        ));

        return Cache::remember($cacheKey, $this->summaryWorkbenchCacheSeconds($params), function () use ($params): array {
            try {
                $summaryRows = $this->adNetworkFailureSummaryRows($params);
                if ($summaryRows->isEmpty()) {
                    return [
                        'available' => false,
                        'source' => $this->eventTable(),
                        'reason' => '当前筛选范围没有携带 country/asn/server_id/protocol 网络上下文的广告事件。',
                        'dimensions' => ['country_code', 'asn', 'server_id', 'protocol'],
                        'rows' => [],
                        'totals' => $this->emptyAdNetworkFailureTotals(),
                    ];
                }

                $reasonRows = $this->adNetworkFailureReasonRows($params)
                    ->groupBy(fn ($row): string => $this->adNetworkFailureDimensionKey(
                        (string) $row->country_code,
                        (string) $row->asn,
                        (string) $row->server_id,
                        (string) $row->protocol
                    ));
                $totals = $this->adNetworkFailureTotals($summaryRows);
                $rows = $summaryRows
                    ->map(fn ($row): array => $this->formatAdNetworkFailureRow(
                        $row,
                        $reasonRows->get($this->adNetworkFailureDimensionKey(
                            (string) $row->country_code,
                            (string) $row->asn,
                            (string) $row->server_id,
                            (string) $row->protocol
                        ), collect())
                    ))
                    ->sortByDesc('failureScore')
                    ->values()
                    ->all();

                return [
                    'available' => true,
                    'source' => $this->eventTable(),
                    'dimensions' => ['country_code', 'asn', 'server_id', 'protocol'],
                    'rows' => $rows,
                    'totals' => $totals,
                    'queryHint' => '按 V1.8 明细表里广告事件携带的 country_code、asn、server_id、protocol 横向聚合；用于定位特定国家/ASN/节点/协议下广告请求、加载和展示失败。',
                ];
            } catch (Throwable $exception) {
                Log::warning('jkcl_ad_network_failure_matrix_failed', [
                    'message' => $exception->getMessage(),
                    'projectCode' => $params['projectCode'] ?? null,
                    'dateFrom' => $params['dateFrom'] ?? null,
                    'dateTo' => $params['dateTo'] ?? null,
                ]);

                return [
                    'available' => false,
                    'source' => $this->eventTable(),
                    'reason' => '广告网络失败横向报表读取失败：' . $exception->getMessage(),
                    'dimensions' => ['country_code', 'asn', 'server_id', 'protocol'],
                    'rows' => [],
                    'totals' => $this->emptyAdNetworkFailureTotals(),
                ];
            }
        });
    }

    private function adNetworkFailureSummaryRows(array $params)
    {
        return $this->adNetworkFailureEventQuery($params, [
                'ad_opportunity',
                'ad_request',
                'ad_load_success',
                'ad_load_failed',
                'ad_show_attempt',
                'ad_show_success',
                'ad_show_failed',
                'ad_show_blocked',
                'ad_impression',
                'ad_paid_event',
            ])
            ->selectRaw("COALESCE(NULLIF(ad.country_code, ''), NULLIF(vpn_ctx.ctx_country_code, ''), 'unknown') AS country_code")
            ->selectRaw("COALESCE(CAST(ad.asn AS CHAR), CAST(vpn_ctx.ctx_asn AS CHAR), 'unknown') AS asn")
            ->selectRaw("COALESCE(NULLIF(ad.server_id, ''), NULLIF(vpn_ctx.ctx_server_id, ''), 'unknown') AS server_id")
            ->selectRaw("COALESCE(NULLIF(ad.protocol, ''), NULLIF(vpn_ctx.ctx_protocol, ''), 'unknown') AS protocol")
            ->selectRaw("COUNT(*) AS event_count")
            ->selectRaw("COUNT(DISTINCT NULLIF(ad.my_user_id, '')) AS users")
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
            ->selectRaw("MAX(ad.event_time_utc) AS latest_event_at")
            ->groupBy('country_code', 'asn', 'server_id', 'protocol')
            ->orderByDesc('load_failed_count')
            ->orderByDesc('show_failed_count')
            ->limit(80)
            ->get();
    }

    private function adNetworkFailureReasonRows(array $params)
    {
        return $this->adNetworkFailureEventQuery($params, ['ad_load_failed', 'ad_show_failed', 'ad_show_blocked'])
            ->selectRaw("COALESCE(NULLIF(ad.country_code, ''), NULLIF(vpn_ctx.ctx_country_code, ''), 'unknown') AS country_code")
            ->selectRaw("COALESCE(CAST(ad.asn AS CHAR), CAST(vpn_ctx.ctx_asn AS CHAR), 'unknown') AS asn")
            ->selectRaw("COALESCE(NULLIF(ad.server_id, ''), NULLIF(vpn_ctx.ctx_server_id, ''), 'unknown') AS server_id")
            ->selectRaw("COALESCE(NULLIF(ad.protocol, ''), NULLIF(vpn_ctx.ctx_protocol, ''), 'unknown') AS protocol")
            ->selectRaw("COALESCE(NULLIF(ad.blocked_reason, ''), NULLIF(ad.error_category, ''), NULLIF(ad.error_domain, ''), NULLIF(ad.error_code, ''), 'unknown') AS reason")
            ->selectRaw("COUNT(*) AS events")
            ->selectRaw("COUNT(DISTINCT NULLIF(ad.my_user_id, '')) AS users")
            ->groupBy('country_code', 'asn', 'server_id', 'protocol', 'reason')
            ->orderByDesc('events')
            ->limit(300)
            ->get();
    }

    /**
     * Build an ad-event query with VPN/network context inherited from the same
     * app session. V1.8 ad events may not always carry server/protocol/asn, but
     * the adjacent VPN events in the same session usually do.
     *
     * @param array<int, string> $eventNames
     */
    private function adNetworkFailureEventQuery(array $params, array $eventNames): Builder
    {
        $table = $this->eventTable();
        $contextParams = array_replace($params, [
            'dateFrom' => Carbon::parse($params['dateFrom'])->subDay()->toDateString(),
            'eventModule' => null,
            'placement' => null,
            'adFormat' => null,
            'adSource' => null,
        ]);
        $vpnContext = DB::connection('adb')->table($table)
            ->whereBetween('event_date', [$contextParams['dateFrom'], $contextParams['dateTo']])
            ->where(function (Builder $query): void {
                $query->where('event_name', 'like', 'vpn_%')
                    ->orWhere(function (Builder $session): void {
                        $session->whereNotNull('vpn_session_id')->where('vpn_session_id', '!=', '');
                    });
            });
        $this->applyAdNetworkFailureFilters($vpnContext, $contextParams);
        $vpnContext
            ->whereNotNull('my_user_id')
            ->where('my_user_id', '!=', '')
            ->whereNotNull('session_id')
            ->where('session_id', '!=', '')
            ->selectRaw('project_code AS ctx_project_code')
            ->selectRaw('app_identifier AS ctx_app_identifier')
            ->selectRaw('platform AS ctx_platform')
            ->selectRaw('my_user_id AS ctx_user_id')
            ->selectRaw('session_id AS ctx_session_id')
            ->selectRaw("MAX(NULLIF(country_code, '')) AS ctx_country_code")
            ->selectRaw('MAX(asn) AS ctx_asn')
            ->selectRaw("MAX(NULLIF(server_id, '')) AS ctx_server_id")
            ->selectRaw("MAX(NULLIF(protocol, '')) AS ctx_protocol")
            ->groupBy('project_code', 'app_identifier', 'platform', 'my_user_id', 'session_id');

        $query = DB::connection('adb')->table($table . ' as ad')
            ->leftJoinSub($vpnContext, 'vpn_ctx', function ($join): void {
                $join->on('vpn_ctx.ctx_project_code', '=', 'ad.project_code')
                    ->on('vpn_ctx.ctx_app_identifier', '=', 'ad.app_identifier')
                    ->on('vpn_ctx.ctx_platform', '=', 'ad.platform')
                    ->on('vpn_ctx.ctx_user_id', '=', 'ad.my_user_id')
                    ->on('vpn_ctx.ctx_session_id', '=', 'ad.session_id');
            })
            ->whereBetween('ad.event_date', [$params['dateFrom'], $params['dateTo']])
            ->whereIn('ad.event_name', $eventNames)
            ->where(function (Builder $context): void {
                $context->whereNotNull('ad.asn')
                    ->orWhereNotNull('vpn_ctx.ctx_asn')
                    ->orWhere(function (Builder $server): void {
                        $server->whereNotNull('ad.server_id')->where('ad.server_id', '!=', '');
                    })
                    ->orWhereNotNull('vpn_ctx.ctx_server_id')
                    ->orWhere(function (Builder $protocol): void {
                        $protocol->whereNotNull('ad.protocol')->where('ad.protocol', '!=', '');
                    })
                    ->orWhereNotNull('vpn_ctx.ctx_protocol')
                    ->orWhere('ad.routed_through_vpn', true);
            });
        $this->applyAdNetworkFailureFilters($query, $params, 'ad');

        return $query;
    }

    private function applyAdNetworkFailureFilters(Builder $query, array $params, ?string $alias = null): void
    {
        $prefix = $alias ? $alias . '.' : '';
        foreach ([
            'projectCode' => 'project_code',
            'appIdentifier' => 'app_identifier',
            'country' => 'country_code',
            'appVersion' => 'app_version',
            'buildNumber' => 'app_build',
            'networkType' => 'network_type',
            'qualityStatus' => 'quality_status',
            'sourceType' => null,
        ] as $key => $column) {
            if (empty($params[$key]) || $column === null) {
                continue;
            }
            $query->where($prefix . $column, $params[$key]);
        }

        if (empty($params['projectCode']) && !empty($params['projectCodes'])) {
            $query->whereIn($prefix . 'project_code', $params['projectCodes']);
        }
        if (!empty($params['platform'])) {
            $query->whereRaw('LOWER(' . $prefix . 'platform) = ?', [strtolower((string) $params['platform'])]);
        }
        if (!empty($params['sourceType'])) {
            match ($params['sourceType']) {
                'api' => $query->where($prefix . 'api_seen', true),
                'firebase' => $query->where($prefix . 'firebase_seen', true),
                'both' => $query->where($prefix . 'api_seen', true)->where($prefix . 'firebase_seen', true),
            };
        }
    }

    private function formatAdNetworkFailureRow(object $row, iterable $reasonRows): array
    {
        $requestCount = (int) ($row->request_count ?? 0);
        $loadSuccessCount = (int) ($row->load_success_count ?? 0);
        $loadFailedCount = (int) ($row->load_failed_count ?? 0);
        $showAttemptCount = (int) ($row->show_attempt_count ?? 0);
        $showFailedCount = (int) ($row->show_failed_count ?? 0);
        $showBlockedCount = (int) ($row->show_blocked_count ?? 0);
        $impressionCount = (int) ($row->impression_count ?? 0);
        $failureCount = $loadFailedCount + $showFailedCount + $showBlockedCount;
        $failureBase = $requestCount + $showAttemptCount;
        $loadTerminalCount = $loadSuccessCount + $loadFailedCount;
        $topReasons = collect($reasonRows)
            ->sortByDesc(fn ($reason): int => (int) ($reason->events ?? 0))
            ->take(3)
            ->values()
            ->map(fn ($reason): array => [
                'reason' => (string) ($reason->reason ?? 'unknown'),
                'events' => (int) ($reason->events ?? 0),
                'users' => (int) ($reason->users ?? 0),
                'share' => $this->rate((int) ($reason->events ?? 0), max(1, $failureCount)),
            ])
            ->all();
        $failureRate = $this->rate($failureCount, $failureBase);
        $loadSuccessRate = $this->rate($loadSuccessCount, $requestCount);
        $impressionRate = $this->rate($impressionCount, $showAttemptCount);
        $topReason = $topReasons[0]['reason'] ?? '暂无失败原因';

        return [
            'countryCode' => (string) ($row->country_code ?? 'unknown'),
            'asn' => (string) ($row->asn ?? 'unknown'),
            'serverId' => (string) ($row->server_id ?? 'unknown'),
            'protocol' => (string) ($row->protocol ?? 'unknown'),
            'users' => (int) ($row->users ?? 0),
            'eventCount' => (int) ($row->event_count ?? 0),
            'opportunityUsers' => (int) ($row->opportunity_users ?? 0),
            'opportunityCount' => (int) ($row->opportunity_count ?? 0),
            'requestUsers' => (int) ($row->request_users ?? 0),
            'requestCount' => $requestCount,
            'loadSuccessCount' => $loadSuccessCount,
            'loadFailedCount' => $loadFailedCount,
            'loadSuccessRate' => $loadSuccessRate,
            'showAttemptCount' => $showAttemptCount,
            'showSuccessCount' => (int) ($row->show_success_count ?? 0),
            'showFailedCount' => $showFailedCount,
            'showBlockedCount' => $showBlockedCount,
            'impressionUsers' => (int) ($row->impression_users ?? 0),
            'impressionCount' => $impressionCount,
            'impressionRate' => $impressionRate,
            'failureCount' => $failureCount,
            'failureRate' => $failureRate,
            'failureBase' => $failureBase,
            'loadTerminalCompletenessRate' => $this->rate($loadTerminalCount, $requestCount),
            'revenue' => round(((int) ($row->revenue_micros ?? 0)) / 1000000, 6),
            'latestEventAt' => $row->latest_event_at ?? null,
            'topReasons' => $topReasons,
            'topReason' => $topReason,
            'failureScore' => $failureCount * max(1, $failureRate),
            'status' => $this->adNetworkFailureStatus($failureRate, $loadSuccessRate, $requestCount, $failureCount),
            'suggestion' => $this->adNetworkFailureSuggestion($topReason, $failureRate, $loadSuccessRate, $impressionRate),
        ];
    }

    private function adNetworkFailureTotals($rows): array
    {
        $requestCount = (int) $rows->sum('request_count');
        $loadSuccessCount = (int) $rows->sum('load_success_count');
        $loadFailedCount = (int) $rows->sum('load_failed_count');
        $showAttemptCount = (int) $rows->sum('show_attempt_count');
        $showFailedCount = (int) $rows->sum('show_failed_count');
        $showBlockedCount = (int) $rows->sum('show_blocked_count');
        $impressionCount = (int) $rows->sum('impression_count');
        $failureCount = $loadFailedCount + $showFailedCount + $showBlockedCount;

        return [
            'requestCount' => $requestCount,
            'loadSuccessCount' => $loadSuccessCount,
            'loadFailedCount' => $loadFailedCount,
            'showAttemptCount' => $showAttemptCount,
            'showFailedCount' => $showFailedCount,
            'showBlockedCount' => $showBlockedCount,
            'impressionCount' => $impressionCount,
            'failureCount' => $failureCount,
            'failureRate' => $this->rate($failureCount, $requestCount + $showAttemptCount),
            'loadSuccessRate' => $this->rate($loadSuccessCount, $requestCount),
            'impressionRate' => $this->rate($impressionCount, $showAttemptCount),
            'revenue' => round(((int) $rows->sum('revenue_micros')) / 1000000, 6),
        ];
    }

    private function emptyAdNetworkFailureTotals(): array
    {
        return [
            'requestCount' => 0,
            'loadSuccessCount' => 0,
            'loadFailedCount' => 0,
            'showAttemptCount' => 0,
            'showFailedCount' => 0,
            'showBlockedCount' => 0,
            'impressionCount' => 0,
            'failureCount' => 0,
            'failureRate' => 0,
            'loadSuccessRate' => 0,
            'impressionRate' => 0,
            'revenue' => 0,
        ];
    }

    private function adNetworkFailureStatus(float $failureRate, float $loadSuccessRate, int $requestCount, int $failureCount): string
    {
        if ($requestCount <= 0 && $failureCount <= 0) {
            return 'unavailable';
        }
        if ($failureRate >= 30 || ($requestCount >= 20 && $loadSuccessRate > 0 && $loadSuccessRate < 60)) {
            return 'bad';
        }
        if ($failureRate >= 15 || ($requestCount >= 20 && $loadSuccessRate > 0 && $loadSuccessRate < 80)) {
            return 'warn';
        }

        return 'good';
    }

    private function adNetworkFailureSuggestion(string $reason, float $failureRate, float $loadSuccessRate, float $impressionRate): string
    {
        $normalized = strtolower($reason);
        if (str_contains($normalized, 'no_fill') || str_contains($normalized, 'nofill')) {
            return '广告源无填充偏高：先按国家/ASN 降低该广告位请求频率，检查 AdMob 国家出价、瀑布/竞价源和广告单元配置。';
        }
        if (str_contains($normalized, 'timeout') || str_contains($normalized, 'network')) {
            return '网络超时或链路失败：优先检查该 ASN 到 Google/AdMob 域名的可达性、DNS/TLS、VPN 出口质量和协议回退。';
        }
        if (str_contains($normalized, 'blocked') || str_contains($normalized, 'frequency') || str_contains($normalized, 'cap')) {
            return '展示被策略拦截：检查频控、订阅/隐私状态、页面触发条件和广告机会生成策略是否过严。';
        }
        if ($loadSuccessRate > 0 && $loadSuccessRate < 70) {
            return '请求加载成功率低：先下钻这个国家×ASN×节点×协议组合的 error_code/error_domain，判断是广告源无填充还是网络不可达。';
        }
        if ($impressionRate > 0 && $impressionRate < 70) {
            return '加载后展示转化低：检查缓存是否过期、展示入口是否被跳过、页面切换后 ad_instance_id 是否丢失。';
        }
        if ($failureRate >= 15) {
            return '失败率偏高：先对比同国家不同 ASN、同 ASN 不同节点、同节点不同协议，找出是否是局部网络/节点问题。';
        }

        return '当前组合没有明显广告网络失败；继续观察请求量、展示量和收入变化。';
    }

    private function adNetworkFailureDimensionKey(string $countryCode, string $asn, string $serverId, string $protocol): string
    {
        return implode('|', [$countryCode, $asn, $serverId, $protocol]);
    }

    private function context(array $params): array
    {
        return [
            'dateFrom' => $params['dateFrom'],
            'dateTo' => $params['dateTo'],
            'projectCode' => $params['projectCode'] ?? null,
            'appIdentifier' => $params['appIdentifier'] ?? null,
            'platform' => $params['platform'] ?? null,
            'country' => $params['country'] ?? null,
            'appVersion' => $params['appVersion'] ?? null,
            'buildNumber' => $params['buildNumber'] ?? null,
            'timezone' => $params['timezone'] ?? config('app.timezone', 'Asia/Shanghai'),
            'compareType' => $params['compareType'] ?? 'yesterday_same_period',
            'domain' => $params['domain'] ?? 'ads',
            'unit' => ($params['domain'] ?? 'ads') === 'ads' ? ($params['unit'] ?? 'users') : 'users',
            'sourceType' => $params['sourceType'] ?? null,
            'eventModule' => $params['eventModule'] ?? null,
            'funnelVersion' => 'V1.7',
        ];
    }

    private function formatHealthRow(object $row): array
    {
        $summary = $this->formatSummary($row);
        $hasFunnelData = $summary['dauUsers'] > 0
            || $summary['eligibilityUsers'] > 0
            || $summary['opportunityCount'] > 0
            || $summary['requestCount'] > 0
            || $summary['showAttemptCount'] > 0
            || $summary['impressionCount'] > 0
            || $summary['paidEventCount'] > 0;
        $status = match (true) {
            !$hasFunnelData => 'unavailable',
            !$summary['adViewerRateAvailable'] => 'data_warning',
            default => 'unrated',
        };
        $statusReason = match ($status) {
            'unavailable' => '当前区间没有 V1.7 核心漏斗事件',
            'data_warning' => '存在广告链事件但缺少 app_foreground，覆盖率分母不可用',
            default => 'V1.7 未定义广告浏览者比例的项目健康分级阈值',
        };

        return [
            'projectCode' => $row->project_code,
            'appName' => $row->app_name,
            'appIdentifier' => $row->app_identifier,
            'status' => $status,
            'statusReason' => $statusReason,
            'hasFunnelData' => $hasFunnelData,
            'abnormalStep' => null,
        ] + $summary;
    }

    private function formatSummary(object $row): array
    {
        $dau = (int) ($row->dau_users ?? 0);
        $impressionUsers = (int) ($row->impression_users ?? 0);
        $opportunityUsers = (int) ($row->opportunity_users ?? 0);
        $impressions = (int) ($row->impression_count ?? 0);
        $opportunities = (int) ($row->opportunity_count ?? 0);
        $showAttempts = (int) ($row->show_attempt_count ?? 0);
        $showSuccesses = (int) ($row->show_success_count ?? 0);
        $showFailures = (int) ($row->show_failed_count ?? 0);
        $showBlocked = (int) ($row->show_blocked_count ?? 0);

        return [
            'dauUsers' => $dau,
            'eligibilityUsers' => (int) ($row->eligibility_users ?? 0),
            'eligibleUsers' => (int) ($row->eligible_users ?? 0),
            'opportunityUsers' => $opportunityUsers,
            'requestUsers' => (int) ($row->request_users ?? 0),
            'showAttemptUsers' => (int) ($row->show_attempt_users ?? 0),
            'impressionUsers' => $impressionUsers,
            'paidUsers' => (int) ($row->paid_users ?? 0),
            'connectAttemptUsers' => (int) ($row->connect_attempt_users ?? 0),
            'connectSuccessUsers' => (int) ($row->connect_success_users ?? 0),
            'connectAttemptCount' => (int) ($row->connect_attempt_count ?? 0),
            'connectSuccessCount' => (int) ($row->connect_success_count ?? 0),
            'postConnectOpportunityUsers' => (int) ($row->post_connect_opportunity_users ?? 0),
            'postConnectImpressionUsers' => (int) ($row->post_connect_impression_users ?? 0),
            'adViewerRate' => $this->rate($impressionUsers, $dau),
            'adViewerRateAvailable' => $dau > 0,
            'opportunityCoverageRate' => $this->rate($opportunityUsers, $dau),
            'opportunityCoverageRateAvailable' => $dau > 0,
            'impressionsPerViewer' => $impressionUsers > 0 ? round($impressions / $impressionUsers, 2) : 0,
            'impressionsPerViewerAvailable' => $impressionUsers > 0,
            'fulfillmentRate' => $this->rate($showAttempts, $opportunities),
            'fulfillmentRateAvailable' => $opportunities > 0,
            'adEligibilityRate' => $this->rate((int) ($row->eligible_users ?? 0), $dau),
            'adEligibilityRateAvailable' => $dau > 0,
            'impressionCount' => $impressions,
            'opportunityCount' => $opportunities,
            'requestCount' => (int) ($row->request_count ?? 0),
            'cacheHitCount' => (int) ($row->cache_hit_count ?? 0),
            'realtimeRequestCount' => (int) ($row->realtime_request_count ?? 0),
            'loadSuccessCount' => (int) ($row->load_success_count ?? 0),
            'adReadyCount' => (int) ($row->ad_ready_count ?? 0),
            'showAttemptCount' => $showAttempts,
            'showSuccessCount' => $showSuccesses,
            'showFailedCount' => $showFailures,
            'showBlockedCount' => $showBlocked,
            'paidEventCount' => (int) ($row->paid_event_count ?? 0),
            'revenue' => round(((int) ($row->revenue_micros ?? 0)) / 1000000, 6),
            'latestEventAt' => $row->latest_event_at ?? null,
        ];
    }

    /**
     * Summarize the active funnel with the four cards used by the workbench target UI.
     */
    private function funnelSummary(array $stages, object $row, array $params): array
    {
        $availableStages = array_values(array_filter(
            $stages,
            fn (array $stage): bool => ($stage['available'] ?? true) !== false
        ));
        $head = $availableStages[0] ?? null;
        $tail = $availableStages === [] ? null : $availableStages[array_key_last($availableStages)];
        $loss = $this->biggestFunnelLoss($availableStages);
        $isEventUnit = ($params['domain'] ?? 'ads') === 'ads' && ($params['unit'] ?? 'users') === 'events';
        $tailConversionAvailable = !$isEventUnit && (int) ($head['count'] ?? 0) > 0 && $tail !== null;
        $lossAvailable = !$isEventUnit && count($availableStages) > 1;

        return [
            [
                'key' => 'tail_conversion',
                'label' => '首尾转化率',
                'value' => $tailConversionAvailable ? ($tail['headRate'] ?? null) : null,
                'displayValue' => $tailConversionAvailable
                    ? number_format((float) ($tail['headRate'] ?? 0), 2) . '%'
                    : '暂无数据',
                'note' => ($head['name'] ?? '-') . ' → ' . ($tail['name'] ?? '-'),
                'available' => $tailConversionAvailable,
            ],
            [
                'key' => 'max_loss_step',
                'label' => '最大流失步骤',
                'value' => $lossAvailable ? $loss['step'] : null,
                'displayValue' => $lossAvailable ? $loss['step'] : '暂无数据',
                'note' => $lossAvailable
                    ? '按可比较的相邻节点流失量计算'
                    : '事件链包含并行分支，不能用独立事件总数直接相减',
                'available' => $lossAvailable,
            ],
            [
                'key' => 'lost_count',
                'label' => $isEventUnit ? '流失事件' : '流失用户',
                'value' => $lossAvailable ? $loss['lostCount'] : null,
                'displayValue' => $lossAvailable ? number_format($loss['lostCount']) : '暂无数据',
                'note' => $lossAvailable
                    ? $loss['from'] . ' → ' . $loss['to']
                    : '请在流失诊断中按关联 ID 选择区间计算',
                'available' => $lossAvailable,
            ],
            [
                'key' => 'estimated_revenue_impact',
                'label' => '预计收入影响',
                'value' => null,
                'displayValue' => '暂无数据',
                'note' => 'V1.7 未定义收入影响模型',
                'tone' => 'neutral',
                'available' => false,
            ],
        ];
    }

    private function biggestFunnelLoss(array $stages): array
    {
        $previous = null;
        $loss = [
            'step' => '-',
            'from' => '-',
            'to' => '-',
            'lostCount' => 0,
        ];

        foreach ($stages as $stage) {
            if (($stage['available'] ?? true) === false) {
                continue;
            }
            if ($previous === null) {
                $previous = $stage;
                continue;
            }
            if (($stage['isBranch'] ?? false) === true) {
                continue;
            }
            $lostCount = max(0, (int) ($previous['count'] ?? 0) - (int) ($stage['count'] ?? 0));
            if ($lostCount > $loss['lostCount']) {
                $loss = [
                    'step' => ($previous['name'] ?? '-') . ' → ' . ($stage['name'] ?? '-'),
                    'from' => $previous['name'] ?? '-',
                    'to' => $stage['name'] ?? '-',
                    'lostCount' => $lostCount,
                ];
            }
            $previous = $stage;
        }

        return $loss;
    }

    private function formatFulfillment(object $row): array
    {
        $opportunities = (int) ($row->opportunity_count ?? 0);
        $impressions = (int) ($row->impression_count ?? 0);
        $showAttempts = (int) ($row->show_attempt_count ?? 0);
        $cacheHits = (int) ($row->cache_hit_count ?? 0);
        $cacheMisses = (int) ($row->cache_miss_count ?? 0);
        $cachePuts = (int) ($row->cache_put_count ?? 0);
        $cacheExpired = (int) ($row->cache_expired_count ?? 0);
        $cacheDiscarded = (int) ($row->cache_discard_count ?? 0);
        $preloadRequests = (int) ($row->preload_request_count ?? 0);
        $preloadSuccesses = (int) ($row->preload_success_count ?? 0);
        $preloadTriggerCount = (int) ($row->preload_trigger_count ?? 0);
        $loadSuccesses = (int) ($row->load_success_count ?? 0);
        $loadFailures = (int) ($row->load_failed_count ?? 0);
        $realtimeRequests = (int) ($row->realtime_request_count ?? 0);
        $realtimeRequestsAfterMiss = (int) ($row->realtime_request_after_miss_count ?? 0);
        $cacheMissesWithRequest = (int) ($row->cache_miss_with_request_count ?? 0);
        $requestIds = (int) ($row->request_id_count ?? 0);
        $loadTerminalRequests = (int) ($row->load_terminal_request_count ?? 0);
        $adReadyCount = (int) ($row->ad_ready_count ?? 0);
        $preloadCacheStoreCount = (int) ($row->preload_cache_store_count ?? 0);
        $preloadReadyCount = (int) ($row->preload_ready_count ?? 0);
        $loadSuccessInstances = (int) ($row->load_success_instance_count ?? 0);
        $unshownDiscardInstances = (int) ($row->unshown_discard_instance_count ?? 0);
        $cacheDecisionCount = $cacheHits + $cacheMisses;

        return [
            'opportunityCount' => $opportunities,
            'preloadTriggerCount' => $preloadTriggerCount,
            'requestUsers' => (int) ($row->request_users ?? 0),
            'realtimeRequestUsers' => (int) ($row->realtime_request_users ?? 0),
            'preloadRequestUsers' => (int) ($row->preload_request_users ?? 0),
            'requestCount' => (int) ($row->request_count ?? 0),
            'requestIdCount' => $requestIds,
            'requestAcceptedCount' => null,
            'requestAcceptedAvailable' => false,
            'requestAcceptedReason' => 'V1.7 未定义独立 Request Accepted 事件',
            'requestsPerUser' => (int) ($row->request_users ?? 0) > 0
                ? round((int) ($row->request_count ?? 0) / (int) ($row->request_users ?? 0), 2)
                : 0,
            'loadSuccessCount' => $loadSuccesses,
            'loadFailedCount' => $loadFailures,
            'loadSuccessRequestCount' => (int) ($row->load_success_request_count ?? 0),
            'loadTerminalRequestCount' => $loadTerminalRequests,
            'cacheHitCount' => $cacheHits,
            'cacheMissCount' => $cacheMisses,
            'cacheDecisionCount' => $cacheDecisionCount,
            'cacheStoreCount' => $cachePuts,
            'cacheTakeCount' => (int) ($row->cache_take_count ?? 0),
            'adReadyCount' => $adReadyCount,
            'preloadCacheStoreCount' => $preloadCacheStoreCount,
            'preloadReadyCount' => $preloadReadyCount,
            'showAttemptCount' => $showAttempts,
            'impressionCount' => $impressions,
            'paidEventCount' => (int) ($row->paid_event_count ?? 0),
            'fulfillmentEntryCount' => $cacheHits + $realtimeRequests,
            'realtimeRequestCount' => $realtimeRequests,
            'realtimeRequestAfterMissCount' => $realtimeRequestsAfterMiss,
            'cacheMissWithRequestCount' => $cacheMissesWithRequest,
            'preloadRequestCount' => $preloadRequests,
            'preloadSuccessCount' => $preloadSuccesses,
            'preloadSuccessRate' => $preloadRequests > 0 ? $this->rate($preloadSuccesses, $preloadRequests) : null,
            'preloadSuccessRateAvailable' => $preloadRequests > 0,
            'cacheHitRate' => $cacheDecisionCount > 0 ? $this->rate($cacheHits, $cacheDecisionCount) : null,
            'cacheHitRateAvailable' => $cacheDecisionCount > 0,
            'cacheExpiredCount' => $cacheExpired,
            'cacheDiscardCount' => $cacheDiscarded,
            'loadSuccessInstanceCount' => $loadSuccessInstances,
            'unshownDiscardInstanceCount' => $unshownDiscardInstances,
            'cacheWasteRate' => $loadSuccessInstances > 0
                ? $this->rate($unshownDiscardInstances, $loadSuccessInstances)
                : null,
            'cacheWasteRateAvailable' => $loadSuccessInstances > 0,
            'missWithoutRequestCount' => max(0, $cacheMisses - $cacheMissesWithRequest),
            'requestNotAcceptedCount' => null,
            'loadTerminalMissingCount' => max(0, $requestIds - $loadTerminalRequests),
            'readyLostCount' => null,
            'unusedReadyCount' => null,
            'paidMissingCount' => null,
            'unfulfilledCount' => null,
            'derivedLossReason' => '跨分支计数不能直接相减，需使用 opportunity_id、request_id 或 ad_instance_id 关联后计算',
        ];
    }

    /**
     * Build the ad user-coverage funnel used by overview and workbench.
     */
    private function funnelStages(object $row): array
    {
        $counts = [
            'dau' => (int) ($row->dau_users ?? 0),
            'eligibility' => (int) ($row->eligibility_users ?? 0),
            'eligible' => (int) ($row->eligible_users ?? 0),
            'opportunity' => (int) ($row->opportunity_users ?? 0),
            'request' => (int) ($row->request_users ?? 0),
            'show_attempt' => (int) ($row->show_attempt_users ?? 0),
            'impression' => (int) ($row->impression_users ?? 0),
            'paid' => (int) ($row->paid_users ?? 0),
        ];
        $head = reset($counts) ?: 0;
        $previous = null;
        $opportunityUsers = $counts['opportunity'] ?? 0;

        return collect(self::FUNNEL_STEPS)->map(function ($step) use ($counts, $head, $opportunityUsers, &$previous) {
            $available = (bool) ($step['available'] ?? true);
            $count = $counts[$step['code']] ?? 0;
            $isBranch = (bool) ($step['branch'] ?? false);
            $conversionRate = $previous === null ? 100 : $this->rate($count, $previous);
            if (($step['code'] ?? '') === 'show_attempt') {
                $conversionRate = $this->rate($count, $opportunityUsers);
            }

            $item = [
                'code' => $step['code'],
                'name' => $step['name'],
                'eventName' => $step['event'],
                'count' => $count,
                'conversionRate' => $conversionRate,
                'headRate' => $this->rate($count, $head),
                'lostCount' => $previous === null || $isBranch ? 0 : max(0, $previous - $count),
                'isBranch' => $isBranch,
            ];
            $previous = $count;
            return $item;
        })->all();
    }

    /**
     * Build the active core funnel without mixing UV and event-count semantics.
     */
    private function contextStages(object $row, array $params): array
    {
        $domain = $params['domain'] ?? 'ads';
        $unit = $domain === 'ads' ? ($params['unit'] ?? 'users') : 'users';

        if ($domain === 'quality') {
            return [];
        }
        if ($domain === 'vpn') {
            return $this->vpnFunnelStages($row);
        }
        if ($unit === 'events') {
            return $this->buildStages(self::ADS_EVENT_FUNNEL_STEPS, [
                'opportunity' => (int) ($row->opportunity_count ?? 0),
                'cache_hit' => (int) ($row->cache_hit_count ?? 0),
                'realtime_request' => (int) ($row->realtime_request_count ?? 0),
                'request_accepted' => (int) ($row->request_accepted_count ?? 0),
                'load_success' => (int) ($row->load_success_count ?? 0),
                'ad_ready' => (int) ($row->ad_ready_count ?? 0),
                'show_attempt' => (int) ($row->show_attempt_count ?? 0),
                'impression' => (int) ($row->impression_count ?? 0),
                'paid' => (int) ($row->paid_event_count ?? 0),
            ]);
        }

        return $this->funnelStages($row);
    }

    private function buildStages(array $definitions, array $counts): array
    {
        $head = reset($counts) ?: 0;
        $previous = null;

        return collect($definitions)->map(function (array $step) use ($counts, $head, &$previous): array {
            $available = (bool) ($step['available'] ?? true);
            $count = $counts[$step['code']] ?? 0;
            $isBranch = (bool) ($step['branch'] ?? false);
            $item = [
                'code' => $step['code'],
                'name' => $step['name'],
                'eventName' => $step['event'],
                'count' => $count,
                'conversionRate' => $previous === null ? 100 : $this->rate($count, $previous),
                'headRate' => $this->rate($count, $head),
                'lostCount' => $previous === null || $isBranch ? 0 : max(0, $previous - $count),
                'isBranch' => $isBranch,
                'available' => $available,
                'unavailableReason' => $available ? null : ($step['unavailableReason'] ?? '当前口径不可用'),
            ];
            if (!$isBranch && $available) {
                $previous = $count;
            }
            return $item;
        })->all();
    }

    /**
     * Build VPN funnel with optional pre-connection nodes.
     *
     * Some historical DWS slices do not yet contain home/button aggregates. In
     * that case the node is marked unavailable instead of rendered as a real 0.
     */
    private function vpnFunnelStages(object $row): array
    {
        $definitions = [
            ['code' => 'dau', 'name' => '日活跃用户', 'event' => 'app_foreground'],
            ['code' => 'home_entry', 'name' => '进入VPN首页', 'event' => 'screen_view / core_action'],
            ['code' => 'connect_button_click', 'name' => '连接按钮点击', 'event' => 'element_click'],
            ['code' => 'permission_available', 'name' => 'VPN权限可用', 'event' => 'vpn_permission_result'],
            ['code' => 'node_selected', 'name' => '节点选择', 'event' => 'vpn_node_selected'],
            ['code' => 'connect_attempt', 'name' => '连接尝试', 'event' => 'vpn_connection_start'],
            ['code' => 'connect_success', 'name' => '连接成功', 'event' => 'vpn_connection_result'],
            ['code' => 'post_connect_opportunity', 'name' => '连接后广告机会', 'event' => 'ad_opportunity'],
            ['code' => 'post_connect_impression', 'name' => '连接后广告展示', 'event' => 'ad_impression'],
        ];
        $counts = [
            'dau' => (int) ($row->dau_users ?? 0),
            'home_entry' => property_exists($row, 'vpn_home_entry_users') ? (int) $row->vpn_home_entry_users : null,
            'connect_button_click' => property_exists($row, 'vpn_connect_button_click_users') ? (int) $row->vpn_connect_button_click_users : null,
            'permission_available' => property_exists($row, 'vpn_permission_available_users') ? (int) $row->vpn_permission_available_users : null,
            'node_selected' => property_exists($row, 'vpn_node_selected_users') ? (int) $row->vpn_node_selected_users : null,
            'connect_attempt' => (int) ($row->connect_attempt_users ?? 0),
            'connect_success' => (int) ($row->connect_success_users ?? 0),
            'post_connect_opportunity' => (int) ($row->post_connect_opportunity_users ?? 0),
            'post_connect_impression' => (int) ($row->post_connect_impression_users ?? 0),
        ];
        $head = (int) ($counts['dau'] ?? 0);
        $previous = null;

        return collect($definitions)->map(function (array $step) use ($counts, $head, &$previous): array {
            $rawCount = $counts[$step['code']] ?? null;
            $available = $rawCount !== null;
            $count = $available ? (int) $rawCount : 0;
            $item = [
                'code' => $step['code'],
                'name' => $step['name'],
                'eventName' => $step['event'],
                'count' => $count,
                'conversionRate' => !$available ? null : ($previous === null ? 100 : $this->rate($count, $previous)),
                'headRate' => !$available ? null : $this->rate($count, $head),
                'lostCount' => !$available || $previous === null ? 0 : max(0, $previous - $count),
                'isBranch' => false,
                'available' => $available,
                'unavailableReason' => $available ? null : '当前 DWS 汇总表还没有该前置节点字段，不能按 0 理解。',
            ];
            if ($available) {
                $previous = $count;
            }

            return $item;
        })->all();
    }

    /**
     * Return metric cards with formulas and quality states for the selected domain.
     */
    private function coreMetrics(object $row, array $params): array
    {
        $domain = $params['domain'] ?? 'ads';
        $unit = $domain === 'ads' ? ($params['unit'] ?? 'users') : 'users';
        $summary = $this->formatSummary($row);
        $fulfillment = $this->formatFulfillment($row);

        if ($domain === 'vpn') {
            $connectionMetrics = isset($row->vpn_connection_final_total)
                ? [
                    'total' => (int) ($row->vpn_connection_final_total ?? 0),
                    'successful' => (int) ($row->vpn_connection_final_successful ?? 0),
                ]
                : $this->vpnConnectionMetrics($params);

            return [
                $this->ratioMetric(
                    'vpn_connect_success',
                    '连接尝试成功率',
                    (int) ($row->connect_success_count ?? 0),
                    (int) ($row->connect_attempt_count ?? 0),
                    'connect_success / connect_attempt'
                ),
                $this->ratioMetric(
                    'vpn_session_success',
                    '会话最终成功率',
                    $connectionMetrics['successful'],
                    $connectionMetrics['total'],
                    'connection_id 最终成功数 / connection_id 数'
                ),
                $this->ratioMetric(
                    'vpn_permission_success',
                    '权限阶段成功率',
                    (int) ($row->vpn_permission_success_count ?? 0),
                    (int) ($row->vpn_permission_attempt_count ?? 0),
                    'permission_success_count / permission_attempt_count'
                ),
                $this->ratioMetric(
                    'vpn_node_selection_effective',
                    '节点选择有效率',
                    (int) ($row->vpn_valid_node_selection_count ?? 0),
                    (int) ($row->vpn_node_selection_count ?? 0),
                    'valid_node_selection_count / node_selection_count'
                ),
                $this->ratioMetric(
                    'vpn_tunnel_success',
                    '隧道建立成功率',
                    (int) ($row->vpn_tunnel_success_count ?? 0),
                    (int) ($row->vpn_tunnel_attempt_count ?? 0),
                    'tunnel_success_count / tunnel_attempt_count'
                ),
                $this->ratioMetric(
                    'vpn_fallback_recovery',
                    '协议回退恢复率',
                    (int) ($row->fallback_success_count ?? 0),
                    (int) ($row->fallback_attempt_count ?? 0),
                    'fallback_success / fallback_attempt'
                ),
                $this->unavailableMetric('vpn_network_change_disconnect', '切网断连率', 'network_change_disconnect / active_at_change', '当前事件表没有切网时活跃连接数'),
                $this->ratioMetric(
                    'vpn_reconnect_success',
                    '自动重连成功率',
                    (int) ($row->reconnect_success_count ?? 0),
                    (int) ($row->reconnect_attempt_count ?? 0),
                    'reconnect_success / reconnect_attempt'
                ),
                $this->ratioMetric(
                    'vpn_ip_change',
                    '连接前后 IP 变化率',
                    (int) ($row->ip_changed_count ?? 0),
                    (int) ($row->ip_comparable_count ?? 0),
                    'ip_changed_count / ip_comparable_count'
                ),
            ];
        }

        if ($domain === 'quality') {
            $quality = $this->qualitySummary($params);
            $acceptedEvents = (int) $quality['acceptedEvents'];
            $hasAcceptedEvents = $acceptedEvents > 0;
            $warningMetric = $quality['quarantineAvailable']
                ? $this->negativeRatioMetric(
                    'quality_warning_rate',
                    '质量预警率',
                    (int) $quality['warningEvents'],
                    (int) $quality['observedEvents'],
                    '(明细质量预警 + 隔离事件) / (标准明细 + 隔离事件)'
                )
                : $this->unavailableMetric(
                    'quality_warning_rate',
                    '质量预警率',
                    '(明细质量预警 + 隔离事件) / (标准明细 + 隔离事件)',
                    $quality['quarantineUnavailableReason'],
                );

            return [
                $warningMetric,
                $this->ratioMetric('quality_firebase_coverage', 'Firebase 校准覆盖率', (int) $quality['firebaseEvents'], $acceptedEvents, 'firebase_seen / 标准明细事件'),
                $hasAcceptedEvents
                    ? $this->metric('quality_orphan_opportunity', '孤儿 Opportunity ID', $quality['orphanOpportunityEvents'], 'count', '要求 opportunity_id 的事件中 ID 为空', $quality['orphanOpportunityEvents'] > 0 ? 'warning' : 'normal')
                    : $this->unavailableMetric('quality_orphan_opportunity', '孤儿 Opportunity ID', '要求 opportunity_id 的事件中 ID 为空', '当前切片没有标准明细事件', 'count'),
                $hasAcceptedEvents
                    ? $this->metric('quality_orphan_request', '孤儿 Request ID', $quality['orphanRequestEvents'], 'count', '要求 request_id 的事件中 ID 为空', $quality['orphanRequestEvents'] > 0 ? 'warning' : 'normal')
                    : $this->unavailableMetric('quality_orphan_request', '孤儿 Request ID', '要求 request_id 的事件中 ID 为空', '当前切片没有标准明细事件', 'count'),
                $hasAcceptedEvents
                    ? $this->metric('quality_orphan_instance', '孤儿 Ad Instance ID', $quality['orphanAdInstanceEvents'], 'count', '要求 ad_instance_id 的事件中 ID 为空', $quality['orphanAdInstanceEvents'] > 0 ? 'warning' : 'normal')
                    : $this->unavailableMetric('quality_orphan_instance', '孤儿 Ad Instance ID', '要求 ad_instance_id 的事件中 ID 为空', '当前切片没有标准明细事件', 'count'),
                $quality['averageReceiveDelayMs'] !== null
                    ? $this->metric('quality_receive_delay', '平均接收延迟', $quality['averageReceiveDelayMs'], 'duration', 'AVG(receive_delay_ms)')
                    : $this->unavailableMetric('quality_receive_delay', '平均接收延迟', 'AVG(receive_delay_ms)', '当前切片没有有效接收延迟', 'duration'),
            ];
        }

        if ($unit === 'events') {
            $requests = (int) ($row->request_id_count ?? 0);
            $loadSuccessRequests = (int) ($row->load_success_request_count ?? 0);
            $loadTerminal = (int) ($row->load_terminal_request_count ?? 0);
            $paidCoverage = $this->diagnosisEventChain($params, 'impression', 'paid');
            return [
                $this->ratioMetric('ad_cache_hit_rate', '缓存命中率', $fulfillment['cacheHitCount'], $fulfillment['cacheHitCount'] + $fulfillment['cacheMissCount'], 'cache_hit / (cache_hit + cache_miss)'),
                $this->ratioMetric('ad_realtime_request_rate', 'Miss 后实时请求率', $fulfillment['cacheMissWithRequestCount'], $fulfillment['cacheMissCount'], '有实时请求的 miss opportunity_id / cache_miss opportunity_id'),
                $this->ratioMetric('ad_request_terminal_rate', '请求终态完整率', $loadTerminal, $requests, '有加载终态的 request_id / ad_request request_id'),
                $this->ratioMetric('ad_load_success_rate', '加载成功率', $loadSuccessRequests, $loadTerminal, 'load_success request_id / load_terminal request_id'),
                $this->ratioMetric('ad_show_success_rate', '展示成功率', (int) ($row->impression_count ?? 0), (int) ($row->show_attempt_count ?? 0), 'ad_impression / ad_show_attempt', 95),
                $this->ratioMetric('ad_paid_complete_rate', 'Paid 回调完整率', $paidCoverage['convertedStartCount'], $paidCoverage['startCount'], '按 opportunity_id / request_id / ad_instance_id 关联且晚于 Impression 的 Paid Event / Impression'),
                $summary['impressionsPerViewerAvailable']
                    ? $this->metric('ad_impressions_per_viewer', '人均展示次数', $summary['impressionsPerViewer'], 'decimal', 'impression_count / impression_uv')
                    : $this->unavailableMetric('ad_impressions_per_viewer', '人均展示次数', 'impression_count / impression_uv', '当前切片没有广告展示独立用户', 'decimal'),
            ];
        }

        $requests = (int) ($row->request_id_count ?? 0);
        $loadSuccesses = (int) ($row->load_success_request_count ?? 0);
        $loadTerminal = (int) ($row->load_terminal_request_count ?? 0);
        $loadSuccessInstances = (int) ($row->load_success_instance_count ?? 0);
        $loadSuccessWithoutImpression = (int) ($row->load_success_without_impression_instance_count ?? 0);
        $latencyMetrics = $this->adImpressionLatencyMetrics($params);

        return [
            $this->ratioMetric('ad_eligibility_pass_rate', '广告资格通过率', $summary['eligibleUsers'], $summary['eligibilityUsers'], 'eligible_uv / eligibility_uv'),
            $this->ratioMetric('ad_opportunity_complete_rate', '资格后机会完整率', $summary['opportunityUsers'], $summary['eligibleUsers'], 'opportunity_uv / eligible_uv'),
            $this->ratioMetric('ad_cache_hit_rate', '缓存命中率', $fulfillment['cacheHitCount'], $fulfillment['cacheHitCount'] + $fulfillment['cacheMissCount'], 'cache_hit / (cache_hit + cache_miss)'),
            $this->ratioMetric('ad_realtime_request_rate', '实时请求启动率', $fulfillment['cacheMissWithRequestCount'], $fulfillment['cacheMissCount'], '有实时请求的 miss opportunity_id / cache_miss opportunity_id'),
            $this->ratioMetric('ad_request_load_success_rate', '请求加载成功率', $loadSuccesses, $requests, 'load_success request_id / ad_request request_id'),
            $this->ratioMetric('ad_request_terminal_rate', '请求终态完整率', $loadTerminal, $requests, '有加载终态的 request_id / ad_request request_id'),
            $this->negativeRatioMetric('ad_load_success_without_impression_rate', '加载成功未展示率', $loadSuccessWithoutImpression, $loadSuccessInstances, '无 Impression 的 ad_instance_id / load_success 的 ad_instance_id'),
            $this->ratioMetric('ad_viewer_rate', '广告浏览者比例', $summary['impressionUsers'], $summary['dauUsers'], 'impression_uv / dau_uv'),
            $summary['impressionsPerViewerAvailable']
                ? array_replace(
                    $this->metric('ad_impressions_per_viewer', '人均广告展示次数', $summary['impressionsPerViewer'], 'decimal', 'impression_count / impression_uv'),
                    ['detail' => number_format($summary['impressionCount']) . ' / ' . number_format($summary['impressionUsers'])]
                )
                : $this->unavailableMetric('ad_impressions_per_viewer', '人均广告展示次数', 'impression_count / impression_uv', '当前切片没有广告展示独立用户', 'decimal'),
            $this->durationMetric('ad_request_to_impression_p95', '请求→展示 P95', $latencyMetrics['requestToImpression'], 'impression_time - request_time'),
            $this->durationMetric('ad_load_to_impression_p95', '加载→展示 P95', $latencyMetrics['loadToImpression'], 'impression_time - load_success_time'),
        ];
    }

    /** Format one metric and allow domain-specific health semantics. */
    private function metric(
        string $key,
        string $name,
        int|float $value,
        string $unit,
        string $formula,
        ?string $status = null
    ): array
    {
        $displayValue = match ($unit) {
            'ratio' => number_format($value, 2) . '%',
            'duration' => $this->formatDuration((int) round($value)),
            'decimal' => number_format($value, 2),
            'currency' => '$' . number_format($value, 2),
            default => number_format($value),
        };
        return [
            'metricKey' => $key,
            'name' => $name,
            'value' => $value,
            'displayValue' => $displayValue,
            'unit' => $unit,
            'status' => $status ?? 'unrated',
            'formula' => $formula,
            'source' => 'dwd_app_tracking_event',
            'detail' => null,
            'available' => true,
        ];
    }

    /** Build a ratio metric only when the current slice has a real denominator. */
    private function ratioMetric(
        string $key,
        string $name,
        int|float $numerator,
        int|float $denominator,
        string $formula,
        ?float $healthyThreshold = null
    ): array
    {
        if ($denominator <= 0) {
            return $this->unavailableMetric($key, $name, $formula, '当前切片没有可计算事件');
        }

        $value = $this->rate($numerator, $denominator);
        $status = $healthyThreshold === null
            ? 'unrated'
            : ($value >= $healthyThreshold ? 'normal' : 'warning');

        return array_replace($this->metric($key, $name, $value, 'ratio', $formula, $status), [
            'detail' => number_format($numerator) . ' / ' . number_format($denominator),
        ]);
    }

    /** Build a ratio metric where a lower value is healthier, such as loss or waste rates. */
    private function negativeRatioMetric(
        string $key,
        string $name,
        int|float $numerator,
        int|float $denominator,
        string $formula
    ): array
    {
        if ($denominator <= 0) {
            return $this->unavailableMetric($key, $name, $formula, '当前切片没有可计算事件');
        }

        $value = $this->rate($numerator, $denominator);
        $status = 'unrated';

        return array_replace($this->metric($key, $name, $value, 'ratio', $formula, $status), [
            'detail' => number_format($numerator) . ' / ' . number_format($denominator),
        ]);
    }

    /**
     * Calculate ad request/load to impression latency from correlated ADB event chains.
     */
    private function adImpressionLatencyMetrics(array $params): array
    {
        $events = $this->baseQuery($params)
            ->whereIn('event_name', ['ad_request', 'ad_load_success', 'ad_impression'])
            ->where(function (Builder $query): void {
                $query->whereNotNull('request_id')
                    ->orWhereNotNull('ad_instance_id');
            })
            ->select(['event_name', 'event_time_utc', 'request_id', 'ad_instance_id'])
            ->orderBy('event_time_utc')
            ->get();

        $requestTimes = [];
        $loadTimes = [];
        $requestToImpression = [];
        $loadToImpression = [];

        foreach ($events as $event) {
            $time = strtotime((string) $event->event_time_utc);
            if ($time === false) {
                continue;
            }

            $keys = $this->adCorrelationKeys($event);
            if ($keys === []) {
                continue;
            }

            if ($event->event_name === 'ad_request') {
                $this->appendCorrelationTimes($requestTimes, $keys, $time);
                continue;
            }

            if ($event->event_name === 'ad_load_success') {
                $this->appendCorrelationTimes($loadTimes, $keys, $time);
                continue;
            }

            if ($event->event_name !== 'ad_impression') {
                continue;
            }

            $requestDuration = $this->durationFromCorrelationTimes($requestTimes, $keys, $time);
            if ($requestDuration !== null) {
                $requestToImpression[] = $requestDuration;
            }

            $loadDuration = $this->durationFromCorrelationTimes($loadTimes, $keys, $time);
            if ($loadDuration !== null) {
                $loadToImpression[] = $loadDuration;
            }
        }

        return [
            'requestToImpression' => $requestToImpression,
            'loadToImpression' => $loadToImpression,
        ];
    }

    private function adCorrelationKeys(object $event): array
    {
        $keys = [];
        if (!empty($event->request_id)) {
            $keys[] = 'request:' . $event->request_id;
        }
        if (!empty($event->ad_instance_id)) {
            $keys[] = 'instance:' . $event->ad_instance_id;
        }

        return $keys;
    }

    private function appendCorrelationTimes(array &$timesByKey, array $keys, int $time): void
    {
        foreach ($keys as $key) {
            $timesByKey[$key][] = $time;
        }
    }

    private function durationFromCorrelationTimes(array $timesByKey, array $keys, int $targetTime): ?int
    {
        $sourceTime = null;
        foreach ($keys as $key) {
            foreach ($timesByKey[$key] ?? [] as $candidate) {
                if ($candidate <= $targetTime && ($sourceTime === null || $candidate > $sourceTime)) {
                    $sourceTime = $candidate;
                }
            }
        }

        return $sourceTime === null ? null : max(0, ($targetTime - $sourceTime) * 1000);
    }

    private function durationMetric(string $key, string $name, array $durations, string $formula): array
    {
        $p95 = $this->percentile($durations, 0.95);
        if ($p95 === null) {
            return $this->unavailableMetric($key, $name, $formula, '当前切片没有可关联的请求、加载和展示事件链', 'duration');
        }

        $p50 = $this->percentile($durations, 0.50) ?? $p95;
        return array_replace($this->metric($key, $name, $p95, 'duration', $formula, 'unrated'), [
            'detail' => 'P50 ' . $this->formatDuration($p50) . ' · 样本 ' . number_format(count($durations)),
            'statusReason' => 'V1.7 未定义耗时告警阈值',
        ]);
    }

    /** Describe a metric whose required structured events are absent without fabricating zero. */
    private function unavailableMetric(string $key, string $name, string $formula, string $detail, string $unit = 'ratio'): array
    {
        return [
            'metricKey' => $key,
            'name' => $name,
            'value' => null,
            'displayValue' => '暂无数据',
            'unit' => $unit,
            'status' => 'unavailable',
            'formula' => $formula,
            'source' => 'dwd_app_tracking_event',
            'detail' => $detail,
            'available' => false,
        ];
    }

    /**
     * Build the VPN connection-stage table from standardized ADB events.
     */
    private function vpnStageHealth(array $params, ?array $comparisonParams): array
    {
        $currentRows = $this->vpnHealthEventRows($params);
        $comparisonByKey = $comparisonParams
            ? collect($this->vpnStageHealthRows($this->vpnHealthEventRows($comparisonParams)))->keyBy('stageKey')
            : collect();

        $stages = collect($this->vpnStageHealthRows($currentRows))
            ->map(function (array $stage) use ($comparisonByKey): array {
                $baseline = $comparisonByKey->get($stage['stageKey']);
                $delta = $baseline && $stage['successRate'] !== null && $baseline['successRate'] !== null
                    ? round($stage['successRate'] - $baseline['successRate'], 2)
                    : null;

                return $stage + [
                    'baselineDelta' => $delta,
                    'displayBaselineDelta' => $delta === null
                        ? '暂无基线'
                        : (($delta > 0 ? '+' : '') . number_format($delta, 2) . 'pp'),
                ];
            })
            ->values()
            ->all();

        return [
            'stages' => $stages,
            'strip' => $this->vpnHealthStrip($currentRows),
        ];
    }

    /**
     * Fetch only VPN events needed by the connection-stage panel.
     */
    private function vpnHealthEventRows(array $params)
    {
        return $this->baseQuery($params)
            ->whereIn('event_name', [
                'vpn_connection_start',
                'vpn_permission_result',
                'vpn_node_selected',
                'vpn_connection_phase',
                'vpn_connection_result',
                'vpn_connectivity_check',
            ])
            ->get([
                'event_id',
                'event_time_utc',
                'event_name',
                'result_status',
                'error_category',
                'error_code',
                'trigger_type',
                'session_id',
                'event_params_json',
            ]);
    }

    /**
     * Format stage rows in the same order as the product-analysis workbench.
     */
    private function vpnStageHealthRows($events): array
    {
        $definitions = [
            ['key' => 'connection_start', 'stage' => '连接开始', 'event' => 'vpn_connection_start', 'events' => ['vpn_connection_start']],
            ['key' => 'permission', 'stage' => '权限通过', 'event' => 'vpn_permission_result', 'events' => ['vpn_permission_result']],
            ['key' => 'node_selected', 'stage' => '节点选择', 'event' => 'vpn_node_selected', 'events' => ['vpn_node_selected']],
            ['key' => 'dns_resolve', 'stage' => 'DNS解析', 'event' => 'vpn_connection_phase · dns_resolve', 'events' => ['vpn_connection_phase'], 'phase' => 'dns_resolve'],
            ['key' => 'socket_connect', 'stage' => 'Socket连接', 'event' => 'vpn_connection_phase · socket_connect', 'events' => ['vpn_connection_phase'], 'phase' => 'socket_connect'],
            ['key' => 'protocol_handshake', 'stage' => '协议握手', 'event' => 'vpn_connection_phase · protocol_handshake', 'events' => ['vpn_connection_phase'], 'phase' => 'protocol_handshake'],
            ['key' => 'connectivity_check', 'stage' => '出口可用性', 'event' => 'vpn_connectivity_check', 'events' => ['vpn_connectivity_check']],
        ];

        return collect($definitions)->map(function (array $definition) use ($events): array {
            $matched = $events->filter(fn ($row) => $this->matchesVpnStageDefinition($row, $definition))->values();
            $total = $matched->count();
            $success = $matched->filter(fn ($row) => $this->vpnStageRowSuccessful($row, $definition))->count();
            $durations = $matched
                ->map(fn ($row) => $this->vpnDurationMs($this->eventParams($row)))
                ->filter(fn ($value) => $value !== null && $value >= 0)
                ->values()
                ->all();
            $successRate = $total > 0 ? $this->rate($success, $total) : null;
            $p95 = $this->percentile95($durations);

            return [
                'stageKey' => $definition['key'],
                'stage' => $definition['stage'],
                'eventName' => $definition['event'],
                'successCount' => $success,
                'totalCount' => $total,
                'displaySuccessCount' => $total > 0 ? number_format($success) : '暂无数据',
                'successRate' => $successRate,
                'displaySuccessRate' => $successRate === null ? '暂无数据' : number_format($successRate, 2) . '%',
                'p95Ms' => $p95,
                'displayP95' => $p95 === null ? '暂无数据' : $this->formatDuration($p95),
                'status' => $this->vpnStageStatus($successRate, $p95),
                'available' => $total > 0,
                'evidenceKeyword' => $definition['phase'] ?? $definition['events'][0],
            ];
        })->all();
    }

    private function matchesVpnStageDefinition(object $row, array $definition): bool
    {
        if (!in_array($row->event_name, $definition['events'], true)) {
            return false;
        }
        if (!isset($definition['phase'])) {
            return true;
        }

        $params = $this->eventParams($row);
        $phase = $params['phase']
            ?? $params['connection_phase']
            ?? $params['stage']
            ?? $params['probe_stage']
            ?? null;

        return $phase === $definition['phase'];
    }

    private function vpnStageRowSuccessful(object $row, array $definition): bool
    {
        if ($definition['key'] === 'connection_start' || $definition['key'] === 'node_selected') {
            return true;
        }

        return $this->isSuccessfulStatus($this->vpnStatusValue($row));
    }

    private function vpnHealthStrip($events): array
    {
        $startIds = $events->where('event_name', 'vpn_connection_start')
            ->map(fn ($row) => $this->vpnConnectionId($row))
            ->filter()
            ->unique()
            ->values();
        $resultIds = $events->where('event_name', 'vpn_connection_result')
            ->map(fn ($row) => $this->vpnConnectionId($row))
            ->filter()
            ->unique()
            ->values();
        $startCount = $startIds->count();
        $coveredCount = $startIds->intersect($resultIds)->count();
        $connectivityRows = $events->where('event_name', 'vpn_connectivity_check')->values();
        $connectivityTotal = $connectivityRows->count();
        $connectivitySuccess = $connectivityRows
            ->filter(fn ($row) => $this->vpnStageRowSuccessful($row, ['key' => 'connectivity_check']))
            ->count();

        return [
            [
                'key' => 'result_coverage',
                'label' => '结果覆盖率',
                'value' => $startCount > 0 ? number_format($this->rate($coveredCount, $startCount), 2) . '%' : '暂无数据',
                'detail' => $startCount > 0
                    ? number_format($coveredCount) . ' / ' . number_format($startCount)
                    : '需要 connection_id 关联 start 与 result',
                'available' => $startCount > 0,
            ],
            [
                'key' => 'first_failure_stage',
                'label' => '首个失败阶段',
                ...$this->topFailureSignal($events),
            ],
            [
                'key' => 'restriction_signal',
                'label' => '限制信号',
                ...$this->topRestrictionSignal($events),
            ],
            [
                'key' => 'connectivity_available',
                'label' => '连接后可用',
                'value' => $connectivityTotal > 0 ? number_format($this->rate($connectivitySuccess, $connectivityTotal), 2) . '%' : '暂无数据',
                'detail' => $connectivityTotal > 0
                    ? number_format($connectivitySuccess) . ' / ' . number_format($connectivityTotal)
                    : 'vpn_connectivity_check',
                'available' => $connectivityTotal > 0,
            ],
        ];
    }

    private function topFailureSignal($events): array
    {
        $failed = $events->filter(function ($row): bool {
            $status = $this->vpnStatusValue($row);

            return $this->vpnConnectionId($row) !== null
                && $status !== null
                && !$this->isSuccessfulStatus($status);
        })
            ->sortBy(fn ($row) => (string) ($row->event_time_utc ?? ''))
            ->groupBy(fn ($row) => $this->vpnConnectionId($row))
            ->map(fn ($group) => $group->first())
            ->values();
        $total = $failed->count();
        if ($total === 0) {
            return ['value' => '暂无数据', 'detail' => '每个 connection_id 仅归因一次', 'available' => false];
        }

        $grouped = $failed->groupBy(function ($row): string {
            $params = $this->eventParams($row);
            return (string) (
                $params['first_failure_stage']
                ?? $params['fail_stage']
                ?? $params['error_stage']
                ?? $params['phase']
                ?? $row->error_category
                ?? $row->error_code
                ?? 'unknown'
            );
        })->map->count()->sortDesc();
        $name = (string) $grouped->keys()->first();
        $count = (int) $grouped->first();

        return [
            'value' => $name . ' ' . number_format($this->rate($count, $total), 2) . '%',
            'detail' => number_format($count) . ' / ' . number_format($total),
            'available' => true,
        ];
    }

    private function topRestrictionSignal($events): array
    {
        $signals = $events->map(function ($row): ?string {
            $params = $this->eventParams($row);
            return $params['restriction_signal']
                ?? (str_contains((string) $row->error_code, 'blocked') ? $row->error_code : null)
                ?? (str_contains((string) $row->error_category, 'blocked') ? $row->error_category : null);
        })->filter()->values();
        $total = $signals->count();
        if ($total === 0) {
            return ['value' => '暂无数据', 'detail' => 'restriction_signal · 推断值', 'available' => false];
        }

        $grouped = $signals->countBy()->sortDesc();
        $name = (string) $grouped->keys()->first();
        $count = (int) $grouped->first();

        return [
            'value' => $name . ' ' . number_format($this->rate($count, $total), 2) . '%',
            'detail' => number_format($count) . ' / ' . number_format($total),
            'available' => true,
        ];
    }

    private function eventParams(object $row): array
    {
        $params = json_decode((string) ($row->event_params_json ?? ''), true);

        return is_array($params) ? $params : [];
    }

    /**
     * Build ad workbench supplemental panels from the same ADB aggregate result.
     */
    private function adSupplementalPanels(object $row, array $dailyTrend, array $qualityGates): array
    {
        $summary = $this->formatSummary($row);
        $fulfillment = $this->formatFulfillment($row);
        $availableGates = collect($qualityGates)
            ->filter(fn ($gate) => ($gate['available'] ?? false));
        $failedGates = $availableGates
            ->filter(fn ($gate) => ($gate['available'] ?? false) && !($gate['passed'] ?? false))
            ->count();
        $associationGate = collect($qualityGates)->firstWhere('key', 'association_integrity');
        $hasAdChainData = $summary['opportunityCount'] > 0
            || $summary['requestCount'] > 0
            || $summary['impressionCount'] > 0;
        $hasClosureData = (int) $fulfillment['loadSuccessInstanceCount'] > 0;

        return [
            'prechecks' => [
                $this->adPrecheck('sdk_ready', 'SDK 初始化', null, 'sdk_ready', '当前事件表没有独立 SDK 初始化成功快照'),
                $this->adPrecheck('consent_status', '隐私同意可投放', null, 'consent_status', '当前事件表没有结构化隐私同意可投放快照'),
                $this->adPrecheck('subscription_status', '非订阅用户', null, 'subscription_status', '当前事件表没有结构化订阅状态快照'),
                $this->adPrecheck('frequency_cap', '频控通过', null, 'blocked_reason', '当前聚合没有频控通过分母'),
                $this->adPrecheck('network_available', '网络可用', null, 'network_type', '当前聚合没有请求前网络可用判断'),
                $this->adPrecheck('ad_unit_valid', '广告位配置有效', null, 'ad_unit_id', '当前聚合没有广告位配置校验结果'),
            ],
            'trend' => [
                'metrics' => [
                    $this->adTrendMetric('viewer', '浏览者比例', '广告展示独立用户比例', 'V1.7 未定义目标阈值', $dailyTrend, 'adViewerRate'),
                    $this->adTrendMetric('opportunity', '机会覆盖', '机会覆盖率', 'V1.7 未定义目标阈值', $dailyTrend, 'opportunityCoverageRate'),
                ],
            ],
            'technicalChecks' => [
                [
                    'key' => 'context',
                    'title' => '上下文关联',
                    'description' => '检查关键ID与Context',
                    'status' => !$hasAdChainData || !($associationGate['available'] ?? false)
                        ? 'unavailable'
                        : (($associationGate['passed'] ?? false) ? 'good' : 'warn'),
                    'available' => $hasAdChainData && (bool) ($associationGate['available'] ?? false),
                ],
                [
                    'key' => 'tracking',
                    'title' => '打点完整性',
                    'description' => 'P0事件、参数与关联链必须100%',
                    'status' => $availableGates->isEmpty() ? 'unavailable' : ($failedGates > 0 ? 'warn' : 'good'),
                    'available' => $availableGates->isNotEmpty(),
                ],
                [
                    'key' => 'reconcile',
                    'title' => '分源对账',
                    'description' => 'Firebase T+0与AdMob T+3分开判断',
                    'status' => 'warn',
                    'available' => false,
                ],
                [
                    'key' => 'closure',
                    'title' => '修复闭环',
                    'description' => '带证据创建任务并回归验证',
                    'status' => !$hasClosureData
                        ? 'unavailable'
                        : ((int) $fulfillment['unshownDiscardInstanceCount'] > 0 ? 'warn' : 'good'),
                    'available' => $hasClosureData,
                ],
            ],
        ];
    }

    private function adPrecheck(string $key, string $label, ?float $value, string $field, string $reason): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'value' => $value,
            'displayValue' => $value === null ? '暂无数据' : number_format($value, 2) . '%',
            'field' => $field,
            'available' => $value !== null,
            'reason' => $reason,
        ];
    }

    private function adTrendMetric(string $key, string $label, string $metric, string $target, array $dailyTrend, string $field): array
    {
        $items = collect($dailyTrend)->map(function (array $row) use ($field): array {
            $available = (int) ($row['dauUsers'] ?? 0) > 0;
            $value = $available ? (float) ($row[$field] ?? 0) : null;

            return [
                'date' => $row['date'] ?? null,
                'value' => $value,
                'displayValue' => $value === null ? '暂无数据' : number_format($value, 2) . '%',
                'available' => $available,
                'alert' => false,
            ];
        })->values();
        $latest = $items->reverse()->first(fn ($item) => $item['available']) ?: null;

        return [
            'key' => $key,
            'label' => $label,
            'metric' => $metric,
            'target' => $target,
            'latestValue' => $latest['displayValue'] ?? '暂无数据',
            'items' => $items->all(),
        ];
    }

    /**
     * Calculate one terminal result per V1.7 connection_id instead of treating an app session as a VPN attempt.
     */
    private function vpnConnectionMetrics(array $params): array
    {
        $rows = $this->baseQuery($params)
            ->where('event_name', 'vpn_connection_result')
            ->get(['event_id', 'event_time_utc', 'result_status', 'event_params_json']);
        $finalRows = $this->vpnFinalConnectionRows($rows);

        return [
            'total' => $finalRows->count(),
            'successful' => $finalRows
                ->filter(fn ($row) => $this->isSuccessfulConnectionResult($row))
                ->count(),
        ];
    }

    /** Return the latest normalized event for every explicit VPN connection identifier. */
    private function vpnFinalConnectionRows($rows)
    {
        return $rows
            ->filter(fn ($row) => $this->vpnConnectionId($row) !== null)
            ->sortBy(fn ($row) => (string) ($row->event_time_utc ?? ''))
            ->groupBy(fn ($row) => $this->vpnConnectionId($row))
            ->map(fn ($group) => $group->last())
            ->values();
    }

    /** Resolve the required V1.7 connection_id without substituting the broader app session_id. */
    private function vpnConnectionId(object $row): ?string
    {
        $connectionId = $this->eventParams($row)['connection_id'] ?? null;

        return $connectionId === null || $connectionId === '' ? null : (string) $connectionId;
    }

    private function vpnDurationMs(array $params): ?int
    {
        foreach (['duration_ms', 'connect_ms', 'latency_ms', 'elapsed_ms', 'phase_duration_ms', 'cost_ms'] as $key) {
            if (isset($params[$key]) && is_numeric($params[$key])) {
                return (int) $params[$key];
            }
        }

        return null;
    }

    private function vpnStatusValue(object $row): ?string
    {
        $params = $this->eventParams($row);
        $status = $row->result_status
            ?? $params['result_status']
            ?? $params['vpn_status']
            ?? $params['status']
            ?? $params['permission_status']
            ?? $params['connectivity_status']
            ?? null;

        return $status === null ? null : (string) $status;
    }

    private function isSuccessfulStatus(?string $status): bool
    {
        return in_array(strtolower((string) $status), ['success', 'connected', 'ok', 'granted', 'allowed', 'reachable', 'true', '1'], true);
    }

    /** Only the normalized V1.8 success terminal is valid for connection results. */
    private function isSuccessfulConnectionResult(object $row): bool
    {
        return strtolower((string) $this->vpnStatusValue($row)) === 'success';
    }

    private function vpnStageStatus(?float $successRate, ?int $p95Ms): string
    {
        if ($successRate === null) {
            return 'unavailable';
        }

        return 'unrated';
    }

    private function percentile95(array $values): ?int
    {
        return $this->percentile($values, 0.95);
    }

    private function percentile(array $values, float $percentile): ?int
    {
        if ($values === []) {
            return null;
        }
        sort($values, SORT_NUMERIC);
        $index = (int) ceil(count($values) * $percentile) - 1;

        return (int) $values[max(0, min($index, count($values) - 1))];
    }

    private function formatDuration(int $ms): string
    {
        if ($ms >= 1000) {
            return rtrim(rtrim(number_format($ms / 1000, 2), '0'), '.') . 's';
        }

        return number_format($ms) . 'ms';
    }

    /**
     * Build extra VPN workbench panels that mirror the product-analysis target page.
     */
    private function vpnSupplementalPanels(array $params, array $dailyTrend, array $qualityGates): array
    {
        $rows = $this->vpnSupplementalRows($params);

        return [
            'networkChanges' => $this->vpnNetworkChanges($rows),
            'protocolNodeRanking' => $this->vpnProtocolNodeRanking($rows),
            'trend' => $this->vpnTrend($dailyTrend),
            'technicalChecks' => $this->technicalChecks($rows, $qualityGates),
        ];
    }

    /**
     * Fetch VPN rows used by side panels; JSON details are parsed in PHP because ADB stores them as raw text.
     */
    private function vpnSupplementalRows(array $params)
    {
        return $this->baseQuery($params)
            ->whereIn('event_name', [
                'vpn_connection_result',
                'vpn_connection_phase',
                'vpn_connectivity_check',
                'vpn_disconnection',
            ])
            ->get([
                'event_id',
                'event_time_utc',
                'event_name',
                'result_status',
                'error_category',
                'error_code',
                'country_code',
                'network_type',
                'session_id',
                'api_seen',
                'firebase_seen',
                'event_params_json',
            ]);
    }

    private function vpnNetworkChanges($rows): array
    {
        $ipRows = $rows->filter(fn ($row) => $this->hasPair($row, ['ip_before_connect', 'before_ip'], ['ip_after_connect', 'after_ip']));
        $countryRows = $rows->filter(fn ($row) => $this->hasPair($row, ['country_before_connect', 'before_country'], ['country_after_connect', 'after_country', 'exit_country']));
        $asnRows = $rows->filter(fn ($row) => $this->hasPair($row, ['asn_before_connect', 'before_asn'], ['asn_after_connect', 'after_asn', 'exit_asn']));
        $checkRows = $rows->where('event_name', 'vpn_connectivity_check')->values();
        $failedChecks = $checkRows->filter(fn ($row) => !$this->vpnStageRowSuccessful($row, ['key' => 'connectivity_check']));

        return [
            $this->vpnPairMetric('ip_change', 'IP变化', $ipRows, ['ip_before_connect', 'before_ip'], ['ip_after_connect', 'after_ip']),
            $this->vpnPairMetric('country_change', '国家变化', $countryRows, ['country_before_connect', 'before_country'], ['country_after_connect', 'after_country', 'exit_country'], '出口国家符合节点'),
            $this->vpnPairMetric('asn_change', 'ASN变化', $asnRows, ['asn_before_connect', 'before_asn'], ['asn_after_connect', 'after_asn', 'exit_asn'], '网络出口 ASN 变化'),
            [
                'key' => 'exit_verify_failed',
                'label' => '出口验证失败',
                'value' => $checkRows->count() > 0 ? number_format($this->rate($failedChecks->count(), $checkRows->count()), 2) . '%' : '暂无数据',
                'detail' => $checkRows->count() > 0 ? number_format($failedChecks->count()) . ' sessions' : 'vpn_connectivity_check',
                'available' => $checkRows->count() > 0,
                'status' => $failedChecks->count() > 0 ? 'bad' : 'good',
            ],
        ];
    }

    private function vpnPairMetric(
        string $key,
        string $label,
        $rows,
        array $beforeKeys,
        array $afterKeys,
        ?string $fallbackDetail = null
    ): array {
        $total = $rows->count();
        $changed = $rows->filter(function ($row) use ($beforeKeys, $afterKeys): bool {
            $before = $this->firstParam($row, $beforeKeys);
            $after = $this->firstParam($row, $afterKeys);

            return $before !== null && $after !== null && $before !== $after;
        })->count();

        return [
            'key' => $key,
            'label' => $label,
            'value' => $total > 0 ? number_format($this->rate($changed, $total), 2) . '%' : '暂无数据',
            'detail' => $total > 0 ? number_format($changed) . ' / ' . number_format($total) : ($fallbackDetail ?? '缺少连接前后结构化字段'),
            'available' => $total > 0,
            'status' => $total > 0 ? 'unrated' : 'unavailable',
        ];
    }

    private function vpnProtocolNodeRanking($rows): array
    {
        return $this->vpnFinalConnectionRows($rows->where('event_name', 'vpn_connection_result')->values())
            ->groupBy(function ($row): string {
                $protocol = $this->firstParam($row, ['protocol', 'vpn_protocol', 'protocol_name']) ?? '未知协议';
                $node = $this->firstParam($row, ['node_id', 'node_name', 'server_id', 'server_name', 'vpn_node_ip']) ?? '未知节点';

                return $protocol . ' · ' . $node;
            })
            ->map(function ($group, string $key): array {
                $total = $group->count();
                $success = $group->filter(fn ($row) => $this->isSuccessfulConnectionResult($row))->count();
                $durations = $group
                    ->map(fn ($row) => $this->vpnDurationMs($this->eventParams($row)))
                    ->filter(fn ($value) => $value !== null && $value >= 0)
                    ->values()
                    ->all();
                $rate = $total > 0 ? $this->rate($success, $total) : null;
                $p95 = $this->percentile95($durations);
                $status = $this->vpnRankingStatus($rate, $p95);

                return [
                    'key' => $key,
                    'name' => $key,
                    'successRate' => $rate,
                    'displaySuccessRate' => $rate === null ? '暂无数据' : number_format($rate, 2) . '%',
                    'p95Ms' => $p95,
                    'displayP95' => $p95 === null ? '暂无数据' : $this->formatDuration($p95),
                    'sampleCount' => $total,
                    'status' => $status,
                    'grade' => match ($status) {
                        'good' => '优',
                        'warn' => '中',
                        'bad' => '差',
                        'unrated' => '未评级',
                        default => '暂无数据',
                    },
                ];
            })
            ->sortBy([
                ['status', 'asc'],
                ['successRate', 'desc'],
                ['p95Ms', 'asc'],
            ])
            ->take(4)
            ->values()
            ->all();
    }

    private function vpnTrend(array $dailyTrend): array
    {
        $metrics = collect([
            [
                'key' => 'connect_success',
                'label' => '连接成功',
                'name' => 'VPN连接成功率',
                'numeratorKey' => 'connectSuccessCount',
                'denominatorKey' => 'connectAttemptCount',
            ],
            [
                'key' => 'post_connect_opportunity',
                'label' => '连接后机会',
                'name' => '连接后广告机会率',
                'numeratorKey' => 'postConnectOpportunityUsers',
                'denominatorKey' => 'connectSuccessUsers',
            ],
            [
                'key' => 'post_connect_impression',
                'label' => '连接后展示',
                'name' => '连接后广告浏览率',
                'numeratorKey' => 'postConnectImpressionUsers',
                'denominatorKey' => 'connectSuccessUsers',
            ],
        ])->map(function (array $metric) use ($dailyTrend): array {
            $items = collect($dailyTrend)->map(function (array $row) use ($metric): array {
                $numerator = (int) ($row[$metric['numeratorKey']] ?? 0);
                $denominator = (int) ($row[$metric['denominatorKey']] ?? 0);
                $rawValue = $denominator > 0 ? $this->rate($numerator, $denominator) : null;

                return [
                    'date' => $row['date'] ?? null,
                    'value' => $rawValue,
                    'displayValue' => $rawValue === null ? '暂无数据' : number_format($rawValue, 2) . '%',
                    'available' => $rawValue !== null,
                    'alert' => false,
                ];
            })->values();
            $latest = $items->reverse()->first(fn ($item) => $item['available']) ?: null;

            return [
                'key' => $metric['key'],
                'label' => $metric['label'],
                'metric' => $metric['name'],
                'target' => '按 V1.7 口径计算',
                'latestValue' => $latest['displayValue'] ?? '暂无数据',
                'items' => $items->all(),
            ];
        })->values();
        $defaultMetric = $metrics->first();

        return [
            'metric' => $defaultMetric['metric'] ?? 'VPN连接成功率',
            'target' => $defaultMetric['target'] ?? '按 V1.7 口径计算',
            'latestValue' => $defaultMetric['latestValue'] ?? '暂无数据',
            'items' => $defaultMetric['items'] ?? [],
            'metrics' => $metrics->all(),
        ];
    }

    private function technicalChecks($rows, array $qualityGates): array
    {
        $eventCount = $rows->count();
        $hasContext = $rows->contains(fn ($row) => $this->vpnConnectionId($row) !== null);
        $availableGates = collect($qualityGates)->filter(fn ($gate) => ($gate['available'] ?? false));
        $failedGates = $availableGates->filter(fn ($gate) => !($gate['passed'] ?? false))->count();
        $apiRows = $rows->where('api_seen', true)->count();
        $firebaseRows = $rows->where('firebase_seen', true)->count();
        $bothSourceRows = $rows->filter(fn ($row) => (bool) $row->api_seen && (bool) $row->firebase_seen)->count();
        $failedRows = $rows->filter(function ($row): bool {
            if (!in_array($row->event_name, ['vpn_connection_result', 'vpn_connection_phase', 'vpn_connectivity_check'], true)) {
                return false;
            }
            $status = $this->vpnStatusValue($row);

            return $status !== null && ($row->event_name === 'vpn_connection_result'
                ? !$this->isSuccessfulConnectionResult($row)
                : !$this->isSuccessfulStatus($status));
        })->count();

        return [
            [
                'key' => 'context',
                'title' => '上下文关联',
                'description' => $hasContext ? '检查 connection_id 与 Context' : '缺少 connection_id 上下文样本',
                'status' => $eventCount === 0 ? 'unavailable' : ($hasContext ? 'good' : 'warn'),
                'available' => $eventCount > 0,
            ],
            [
                'key' => 'tracking',
                'title' => '打点完整性',
                'description' => $failedGates > 0 ? '存在未通过质量门禁' : 'P0事件、参数与关联链检查',
                'status' => $availableGates->isEmpty() ? 'unavailable' : ($failedGates > 0 ? 'warn' : 'good'),
                'available' => $availableGates->isNotEmpty(),
            ],
            [
                'key' => 'reconcile',
                'title' => '分源对账',
                'description' => "API {$apiRows} 条 · Firebase {$firebaseRows} 条 · 双源 {$bothSourceRows} 条",
                'status' => $eventCount === 0
                    ? 'unavailable'
                    : ($apiRows > 0 && $firebaseRows > 0 ? 'good' : 'warn'),
                'available' => $eventCount > 0,
            ],
            [
                'key' => 'closure',
                'title' => '修复闭环',
                'description' => $failedRows > 0 ? '带证据创建任务并回归验证' : '当前切片暂无失败样本',
                'status' => $eventCount === 0 ? 'unavailable' : ($failedRows > 0 ? 'warn' : 'good'),
                'available' => $eventCount > 0,
            ],
        ];
    }

    private function hasPair(object $row, array $beforeKeys, array $afterKeys): bool
    {
        return $this->firstParam($row, $beforeKeys) !== null && $this->firstParam($row, $afterKeys) !== null;
    }

    private function firstParam(object $row, array $keys): ?string
    {
        $params = $this->eventParams($row);
        foreach ($keys as $key) {
            if (isset($params[$key]) && $params[$key] !== '') {
                return (string) $params[$key];
            }
        }

        return null;
    }

    private function vpnRankingStatus(?float $successRate, ?int $p95Ms): string
    {
        if ($successRate === null) {
            return 'unavailable';
        }
        return 'unrated';
    }

    private function qualitySummary(array $params): array
    {
        $requiresOpportunity = "((event_name = 'ad_request' AND COALESCE(is_preload, 0) = 0) OR event_name IN ('ad_opportunity', 'ad_cache_hit', 'ad_cache_miss', 'ad_cache_take'))";
        $requiresRequest = "event_name IN ('ad_request', 'ad_load_failed', 'ad_load_success', 'ad_ready', 'ad_cache_discard', 'ad_cache_expired', 'ad_cache_hit', 'ad_cache_put', 'ad_cache_take', 'ad_click', 'ad_dismissed', 'ad_impression', 'ad_reward_earned', 'ad_show_attempt', 'ad_show_blocked', 'ad_show_failed', 'ad_show_success', 'ad_paid_event')";
        $requiresInstance = "event_name IN ('ad_load_success', 'ad_ready', 'ad_cache_discard', 'ad_cache_expired', 'ad_cache_hit', 'ad_cache_put', 'ad_cache_take', 'ad_click', 'ad_dismissed', 'ad_impression', 'ad_show_attempt', 'ad_show_blocked', 'ad_show_failed', 'ad_show_success', 'ad_paid_event')";
        $requiresAnyLink = "({$requiresOpportunity} OR {$requiresRequest} OR {$requiresInstance})";
        $row = $this->baseQuery($params)
            ->selectRaw('COUNT(*) AS total_events')
            ->selectRaw('SUM(api_seen = 1) AS api_events')
            ->selectRaw('SUM(firebase_seen = 1) AS firebase_events')
            ->selectRaw("SUM(quality_status = 'warning') AS warning_events")
            ->selectRaw("SUM({$requiresOpportunity} AND NULLIF(opportunity_id, '') IS NULL) AS orphan_opportunity_events")
            ->selectRaw("SUM({$requiresRequest} AND NULLIF(request_id, '') IS NULL) AS orphan_request_events")
            ->selectRaw("SUM({$requiresInstance} AND NULLIF(ad_instance_id, '') IS NULL) AS orphan_ad_instance_events")
            ->selectRaw("SUM(CASE WHEN {$requiresAnyLink} THEN 1 ELSE 0 END) AS required_link_events")
            ->selectRaw("SUM(CASE WHEN ({$requiresOpportunity} AND NULLIF(opportunity_id, '') IS NULL) OR ({$requiresRequest} AND NULLIF(request_id, '') IS NULL) OR ({$requiresInstance} AND NULLIF(ad_instance_id, '') IS NULL) THEN 1 ELSE 0 END) AS orphan_link_events")
            ->selectRaw('AVG(receive_delay_ms) AS avg_receive_delay_ms')
            ->first();
        $quarantine = $this->quarantineSummary($params);
        $acceptedEvents = (int) ($row->total_events ?? 0);
        $acceptedWarnings = (int) ($row->warning_events ?? 0);
        $quarantineEvents = $quarantine['available'] ? (int) $quarantine['total'] : 0;

        return [
            'totalEvents' => $quarantine['available'] ? $acceptedEvents + $quarantineEvents : $acceptedEvents,
            'acceptedEvents' => $acceptedEvents,
            'observedEvents' => $quarantine['available'] ? $acceptedEvents + $quarantineEvents : null,
            'apiEvents' => (int) ($row->api_events ?? 0),
            'firebaseEvents' => (int) ($row->firebase_events ?? 0),
            'warningEvents' => $acceptedWarnings + $quarantineEvents,
            'acceptedWarningEvents' => $acceptedWarnings,
            'quarantineEvents' => $quarantineEvents,
            'quarantineAvailable' => $quarantine['available'],
            'quarantineUnavailableReason' => $quarantine['reason'],
            'quarantineReasons' => $quarantine['reasons'],
            'orphanOpportunityEvents' => (int) ($row->orphan_opportunity_events ?? 0),
            'orphanRequestEvents' => (int) ($row->orphan_request_events ?? 0),
            'orphanAdInstanceEvents' => (int) ($row->orphan_ad_instance_events ?? 0),
            'requiredLinkEvents' => (int) ($row->required_link_events ?? 0),
            'orphanLinkEvents' => (int) ($row->orphan_link_events ?? 0),
            'averageReceiveDelayMs' => $row->avg_receive_delay_ms !== null ? round((float) $row->avg_receive_delay_ms) : null,
        ];
    }

    /**
     * Count rejected events only when every active slice filter can be applied to the quarantine schema.
     */
    private function quarantineSummary(array $params): array
    {
        foreach (['country', 'appVersion', 'buildNumber', 'networkType', 'placement', 'adFormat', 'adSource', 'qualityStatus', 'eventModule'] as $key) {
            if (!empty($params[$key])) {
                return [
                    'available' => false,
                    'total' => 0,
                    'reasons' => [],
                    'reason' => "隔离表不包含 {$key} 维度，当前筛选下不能准确计算",
                ];
            }
        }
        if (($params['sourceType'] ?? null) === 'both') {
            return [
                'available' => false,
                'total' => 0,
                'reasons' => [],
                'reason' => '隔离事件只有单一来源，不能按 API + Firebase 同时出现筛选',
            ];
        }

        try {
            $query = DB::connection('adb')
                ->table((string) config('adb.tracking_events.quarantine_table', 'dwd_app_tracking_event_quarantine'))
                ->whereBetween('event_date', [$params['dateFrom'], $params['dateTo']]);
            if (!empty($params['appIdentifier'])) {
                $query->where('app_identifier', $params['appIdentifier']);
            } elseif (!empty($params['projectCode'])) {
                $query->where('project_code', $params['projectCode']);
            } elseif (!empty($params['projectCodes'])) {
                $query->whereIn('project_code', $params['projectCodes']);
            }
            if (!empty($params['platform'])) {
                $query->where('platform', $params['platform']);
            }
            if (!empty($params['sourceType'])) {
                $query->where('source_type', $params['sourceType']);
            }

            $rows = $query
                ->selectRaw('reason_code, COUNT(*) AS event_count')
                ->groupBy('reason_code')
                ->get();
        } catch (Throwable) {
            return [
                'available' => false,
                'total' => 0,
                'reasons' => [],
                'reason' => 'ADB 隔离表尚不可查询',
            ];
        }

        return [
            'available' => true,
            'total' => (int) $rows->sum('event_count'),
            'reasons' => $rows->mapWithKeys(fn ($item) => [
                (string) $item->reason_code => (int) $item->event_count,
            ])->all(),
            'reason' => null,
        ];
    }

    /**
     * Build data-backed verification gates for the issue-closure page.
     */
    private function qualityGates(array $params): array
    {
        $quality = $this->qualitySummary($params);
        $totalEvents = (int) $quality['acceptedEvents'];
        $requiredLinkEvents = (int) $quality['requiredLinkEvents'];
        $orphanEvents = (int) $quality['orphanLinkEvents'];

        $p0EventNames = $this->p0EventNames();
        $presentP0Events = $p0EventNames === []
            ? 0
            : (int) $this->baseQuery($params)->whereIn('event_name', $p0EventNames)->distinct()->count('event_name');
        $p0EventRate = $p0EventNames === [] ? null : $this->rate($presentP0Events, count($p0EventNames));
        $p0FieldSummary = $this->p0FieldSummary($params);
        $unknownEvents = $this->baseQuery($params)
            ->where(function (Builder $query): void {
                $query->whereRaw("LOWER(COALESCE(network_type, '')) = 'unknown'")
                    ->orWhereRaw("LOWER(COALESCE(result_status, '')) = 'unknown'")
                    ->orWhereRaw("LOWER(COALESCE(error_category, '')) = 'unknown'");
            })
            ->count();
        $associationRate = $requiredLinkEvents > 0
            ? $this->rate(max(0, $requiredLinkEvents - $orphanEvents), $requiredLinkEvents)
            : null;
        $unknownRate = $totalEvents > 0 ? $this->rate($unknownEvents, $totalEvents) : null;

        return [
            [
                'key' => 'p0_event_completeness',
                'label' => 'P0事件完整率',
                'value' => $p0EventRate,
                'unit' => 'ratio',
                'target' => '目标 100%',
                'available' => $p0EventRate !== null,
                'passed' => $p0EventRate !== null && $p0EventRate >= 100,
                'rule' => $p0EventRate === null
                    ? 'RDS 尚未初始化 V1.7 P0 事件规范'
                    : sprintf('已出现 %d / %d 个 P0 事件', $presentP0Events, count($p0EventNames)),
            ],
            [
                'key' => 'p0_parameter_completeness',
                'label' => 'P0参数完整率',
                'value' => $p0FieldSummary['rate'],
                'unit' => 'ratio',
                'target' => '目标 100%',
                'available' => $p0FieldSummary['rate'] !== null,
                'passed' => $p0FieldSummary['rate'] !== null && $p0FieldSummary['rate'] >= 100,
                'rule' => $p0FieldSummary['message'],
            ],
            [
                'key' => 'association_integrity',
                'label' => '关键ID完整率',
                'value' => $associationRate,
                'unit' => 'ratio',
                'target' => '目标 100%',
                'available' => $associationRate !== null,
                'passed' => $associationRate !== null && $associationRate >= 100,
                'rule' => '要求关联ID的事件中，Opportunity、Request、Ad Instance ID 均非空',
            ],
            [
                'key' => 'unknown_rate',
                'label' => 'Unknown率',
                'value' => $unknownRate,
                'unit' => 'ratio',
                'target' => '目标 < 1%',
                'available' => $unknownRate !== null,
                'passed' => $unknownRate !== null && $unknownRate < 1,
                'rule' => '网络、结果状态或错误分类为 unknown 的事件占比',
            ],
        ];
    }

    /**
     * Return the fixed gate structure when an issue does not yet have a verifiable ADB scope.
     */
    private function unavailableQualityGates(string $reason): array
    {
        return collect([
            ['key' => 'p0_event_completeness', 'label' => 'P0事件完整率', 'target' => '目标 100%'],
            ['key' => 'p0_parameter_completeness', 'label' => 'P0参数完整率', 'target' => '目标 100%'],
            ['key' => 'association_integrity', 'label' => '关键ID完整率', 'target' => '目标 100%'],
            ['key' => 'unknown_rate', 'label' => 'Unknown率', 'target' => '目标 < 1%'],
        ])->map(fn (array $gate) => $gate + [
            'value' => null,
            'unit' => 'ratio',
            'available' => false,
            'passed' => false,
            'rule' => $reason,
        ])->all();
    }

    /** Keep the issue workflow queryable when ADB quality data is temporarily unavailable. */
    private function issueQualityGates(array $scope): array
    {
        try {
            return $this->qualityGates($scope);
        } catch (Throwable) {
            return $this->unavailableQualityGates('ADB 事件或质量数据暂时不可查询');
        }
    }

    /**
     * Read distinct version/build pairs so the UI can use the target's single App version selector.
     */
    private function versionOptions(): array
    {
        return DB::connection('adb')->table($this->eventTable())
            ->whereNotNull('app_version')
            ->where('app_version', '!=', '')
            ->select(['app_version', 'app_build'])
            ->distinct()
            ->orderBy('app_version')
            ->orderBy('app_build')
            ->limit(200)
            ->get()
            ->map(fn ($row) => [
                'appVersion' => $row->app_version,
                'buildNumber' => $row->app_build === null ? null : (int) $row->app_build,
            ])
            ->all();
    }

    /**
     * Resolve the active V1.7 P0 event list from the RDS specification control plane.
     */
    private function p0EventNames(): array
    {
        if (!Schema::hasTable('tracking_spec_field')) {
            return [];
        }

        return DB::table('tracking_spec_field')
            ->where('is_active', 1)
            ->whereNotNull('standard_event_name')
            ->where('standard_event_name', '!=', '')
            ->where('requirement_level', 'like', 'P0%')
            ->distinct()
            ->orderBy('standard_event_name')
            ->pluck('standard_event_name')
            ->all();
    }

    /**
     * Read the P0 parameter completeness aggregate when the ADB quality task has produced it.
     */
    private function p0FieldSummary(array $params): array
    {
        try {
            $query = DB::connection('adb')->table('dws_app_event_quality_daily')
                ->whereBetween('stat_date', [$params['dateFrom'], $params['dateTo']]);
            foreach ([
                'project_code' => 'projectCode',
                'app_identifier' => 'appIdentifier',
                'platform' => 'platform',
                'country_code' => 'country',
                'app_version' => 'appVersion',
            ] as $column => $key) {
                if (!empty($params[$key])) {
                    $query->where($column, $params[$key]);
                }
            }
            $row = $query->selectRaw('SUM(p0_field_total) AS field_total, SUM(p0_field_present) AS field_present')->first();
        } catch (Throwable) {
            return ['rate' => null, 'message' => 'ADB 尚未创建或无法查询事件质量日汇总表'];
        }
        $fieldTotal = (int) ($row->field_total ?? 0);
        $fieldPresent = (int) ($row->field_present ?? 0);
        if ($fieldTotal === 0) {
            return ['rate' => null, 'message' => '选定范围尚未生成 P0 参数质量汇总'];
        }

        return [
            'rate' => $this->rate($fieldPresent, $fieldTotal),
            'message' => sprintf('已上报 %d / %d 个适用 P0 参数', $fieldPresent, $fieldTotal),
        ];
    }

    private function sourceLabel(bool $apiSeen, bool $firebaseSeen): string
    {
        return match (true) {
            $apiSeen && $firebaseSeen => 'API + Firebase',
            $firebaseSeen => 'Firebase',
            default => 'API',
        };
    }

    private function freshness(array $params): array
    {
        $coreEvents = "'" . implode("','", self::CORE_METRIC_EVENTS) . "'";
        $row = $this->baseQuery($params)
            ->selectRaw('MAX(event_time_utc) AS latest_event_at, MAX(updated_at) AS latest_loaded_at')
            ->selectRaw("SUM(data_status = 'realtime') AS realtime_rows")
            ->selectRaw("SUM(data_status IN ('verified', 'final')) AS verified_rows")
            ->selectRaw('SUM(CASE WHEN firebase_seen = 1 THEN 1 ELSE 0 END) AS firebase_rows')
            ->selectRaw('SUM(CASE WHEN api_seen = 1 AND firebase_seen = 1 THEN 1 ELSE 0 END) AS reconciled_rows')
            ->selectRaw("SUM(CASE WHEN event_name IN ({$coreEvents}) THEN 1 ELSE 0 END) AS core_rows")
            ->selectRaw("SUM(CASE WHEN event_name IN ({$coreEvents}) AND firebase_seen = 1 THEN 1 ELSE 0 END) AS core_firebase_rows")
            ->selectRaw("SUM(CASE WHEN event_name IN ({$coreEvents}) AND api_seen = 1 AND firebase_seen = 1 THEN 1 ELSE 0 END) AS core_reconciled_rows")
            ->first();
        $coreRows = (int) ($row->core_rows ?? 0);
        $coreFirebaseRows = (int) ($row->core_firebase_rows ?? 0);
        $coreReconciledRows = (int) ($row->core_reconciled_rows ?? 0);
        $calibrationStatus = match (true) {
            $coreRows === 0 => 'unavailable',
            $coreReconciledRows === $coreRows => 'calibrated',
            $coreFirebaseRows === $coreRows => 'firebase',
            $coreFirebaseRows > 0 => 'partial',
            default => 'realtime',
        };

        return [
            'latestEventAt' => $row->latest_event_at ?? null,
            'latestLoadedAt' => $row->latest_loaded_at ?? null,
            'realtimeRows' => (int) ($row->realtime_rows ?? 0),
            'verifiedRows' => (int) ($row->verified_rows ?? 0),
            'firebaseRows' => (int) ($row->firebase_rows ?? 0),
            'reconciledRows' => (int) ($row->reconciled_rows ?? 0),
            'coreRows' => $coreRows,
            'coreFirebaseRows' => $coreFirebaseRows,
            'coreReconciledRows' => $coreReconciledRows,
            'calibrationStatus' => $calibrationStatus,
        ];
    }

    private function emptyAggregate(): object
    {
        return (object) [
            'dau_users' => 0, 'eligibility_users' => 0, 'eligible_users' => 0, 'opportunity_users' => 0,
            'request_users' => 0, 'show_attempt_users' => 0, 'impression_users' => 0, 'paid_users' => 0,
            'opportunity_count' => 0, 'request_count' => 0, 'request_id_count' => 0,
            'load_success_count' => 0, 'load_failed_count' => 0,
            'load_success_request_count' => 0, 'load_failed_request_count' => 0,
            'load_terminal_request_count' => 0,
            'cache_hit_count' => 0, 'cache_miss_count' => 0, 'cache_put_count' => 0, 'cache_take_count' => 0,
            'cache_expired_count' => 0, 'cache_discard_count' => 0, 'realtime_request_count' => 0,
            'realtime_request_after_miss_count' => 0, 'cache_miss_with_request_count' => 0,
            'realtime_request_users' => 0, 'preload_request_users' => 0, 'preload_trigger_count' => 0,
            'request_accepted_count' => 0, 'preload_request_count' => 0, 'preload_success_count' => 0,
            'preload_cache_store_count' => 0, 'preload_ready_count' => 0, 'load_success_instance_count' => 0,
            'load_success_without_impression_instance_count' => 0, 'unshown_discard_instance_count' => 0,
            'show_attempt_count' => 0, 'show_success_count' => 0, 'show_failed_count' => 0,
            'show_blocked_count' => 0,
            'ad_ready_count' => 0, 'impression_count' => 0, 'paid_event_count' => 0, 'revenue_micros' => 0,
            'connect_attempt_users' => 0, 'connect_success_users' => 0,
            'post_connect_opportunity_users' => 0, 'post_connect_impression_users' => 0,
            'connect_attempt_count' => 0, 'connect_success_count' => 0,
            'fallback_attempt_count' => 0, 'fallback_success_count' => 0, 'reconnect_attempt_count' => 0,
            'reconnect_success_count' => 0, 'latest_event_at' => null,
        ];
    }

    private function weakestStep(array $stages): ?string
    {
        $weakest = collect($stages)->skip(1)->sortBy('conversionRate')->first();
        return $weakest ? $weakest['name'] : null;
    }

    private function stepEvent(string $code, array $params = []): string
    {
        $step = collect($this->stepDefinitions($params))->firstWhere('code', $code);

        return $step['event'] ?? $code;
    }

    private function stepDefinitions(array $params): array
    {
        if (($params['domain'] ?? 'ads') === 'vpn') return self::VPN_FUNNEL_STEPS;
        if (($params['domain'] ?? 'ads') === 'ads' && ($params['unit'] ?? 'users') === 'events') {
            return self::ADS_EVENT_FUNNEL_STEPS;
        }
        return self::FUNNEL_STEPS;
    }

    private function pathItems(array $counts, int $total, string $nameKey = 'eventName'): array
    {
        return collect($counts)->take(20)->map(fn ($count, $name) => [
            $nameKey => $name,
            'count' => $count,
            'share' => $this->rate((int) $count, $total),
        ])->values()->all();
    }

    /** Format page health and ID-linked monetization without hiding invalid exit telemetry. */
    private function formatPageRow(
        object $row,
        ?object $monetization = null,
        ?object $funnel = null,
        iterable $eligibilityReasons = [],
        ?object $requestOutcome = null,
        ?object $correlatedImpression = null
    ): array
    {
        $screenUv = (int) ($row->screen_uv ?? 0);
        $entries = (int) ($row->entry_count ?? 0);
        $exits = (int) ($row->exit_count ?? 0);
        $exitRateAvailable = $entries > 0 && $exits <= $entries;
        $opportunityUsers = (int) ($monetization->opportunity_users ?? 0);
        $impressionUsers = (int) ($monetization->impression_users ?? 0);
        $pageUsers = (int) ($funnel->page_users ?? $screenUv);
        $eligibilityCheckUsers = (int) ($funnel->eligibility_check_users ?? 0);
        $eligibleUsers = (int) ($funnel->eligible_users ?? 0);
        $pageOpportunityUsers = (int) ($funnel->opportunity_users ?? $opportunityUsers);
        $requestUsers = (int) ($funnel->request_users ?? $requestOutcome->request_users ?? 0);
        $requestSuccessUsers = (int) ($requestOutcome->request_success_users ?? $funnel->request_success_users ?? $funnel->load_success_users ?? 0);
        $requestSuccessCount = (int) ($requestOutcome->request_success_count ?? $funnel->request_success_count ?? $funnel->load_success_count ?? 0);
        $requestFailedUsers = (int) ($requestOutcome->request_failed_users ?? $funnel->request_failed_users ?? $funnel->load_failed_users ?? 0);
        $requestFailedCount = (int) ($requestOutcome->request_failed_count ?? $funnel->request_failed_count ?? $funnel->load_failed_count ?? 0);
        $topRequestFailReason = $requestOutcome->top_request_fail_reason ?? $funnel->top_request_fail_reason ?? null;
        $errorCode = $requestOutcome->error_code ?? $funnel->error_code ?? null;
        $errorDomain = $requestOutcome->error_domain ?? $funnel->error_domain ?? null;
        $preloadRequestUsers = (int) ($funnel->preload_request_users ?? 0);
        $cacheHitUsers = (int) ($funnel->cache_hit_users ?? 0);
        $showAttemptUsers = (int) ($funnel->show_attempt_users ?? 0);
        $pageImpressionUsers = (int) ($funnel->impression_users ?? $impressionUsers);
        $correlatedImpressionUsers = (int) ($correlatedImpression->correlated_impression_users ?? 0);
        $linkedImpressionUsers = $pageImpressionUsers;
        $showAttemptBase = $requestUsers + $cacheHitUsers;
        $requestTerminalUsers = $requestSuccessUsers + $requestFailedUsers;
        return [
            'screenName' => $row->screen_name,
            'screenUsers' => $screenUv,
            'entryCount' => $entries,
            'exitCount' => $exits,
            'exitRate' => $exitRateAvailable ? $this->rate($exits, $entries) : null,
            'exitRateAvailable' => $exitRateAvailable,
            'exitRateReason' => $exitRateAvailable
                ? null
                : ($entries === 0 ? '缺少 screen_view 进入事件' : 'screen_exit 数量超过 screen_view，当前退出率不可用'),
            'errorCount' => (int) ($row->error_count ?? 0),
            'errorRate' => $this->rate((int) ($row->error_users ?? 0), $screenUv),
            'errorRateAvailable' => $screenUv > 0,
            'pageUsers' => $pageUsers,
            'eligibilityCheckUsers' => $eligibilityCheckUsers,
            'eligibleUsers' => $eligibleUsers,
            'opportunityUsers' => $pageOpportunityUsers,
            'requestUsers' => $requestUsers,
            'request_users' => $requestUsers,
            'loadSuccessUsers' => $requestSuccessUsers,
            'load_success_users' => $requestSuccessUsers,
            'requestSuccessUsers' => $requestSuccessUsers,
            'request_success_users' => $requestSuccessUsers,
            'requestSuccessCount' => $requestSuccessCount,
            'request_success_count' => $requestSuccessCount,
            'loadFailedUsers' => $requestFailedUsers,
            'load_failed_users' => $requestFailedUsers,
            'requestFailedUsers' => $requestFailedUsers,
            'request_failed_users' => $requestFailedUsers,
            'requestFailedCount' => $requestFailedCount,
            'request_failed_count' => $requestFailedCount,
            'requestTerminalUsers' => $requestTerminalUsers,
            'request_terminal_users' => $requestTerminalUsers,
            'requestTerminalMissingUsers' => max(0, $requestUsers - $requestTerminalUsers),
            'request_terminal_missing_users' => max(0, $requestUsers - $requestTerminalUsers),
            'topRequestFailReason' => $topRequestFailReason,
            'top_request_fail_reason' => $topRequestFailReason,
            'errorCode' => $errorCode,
            'error_code' => $errorCode,
            'errorDomain' => $errorDomain,
            'error_domain' => $errorDomain,
            'requestFailReasons' => $requestOutcome->request_fail_reasons ?? [],
            'request_fail_reasons' => $requestOutcome->request_fail_reasons ?? [],
            'requestBreakdownSource' => $requestOutcome->request_breakdown_source ?? null,
            'request_breakdown_source' => $requestOutcome->request_breakdown_source ?? null,
            'preloadRequestUsers' => $preloadRequestUsers,
            'cacheHitUsers' => $cacheHitUsers,
            'showAttemptUsers' => $showAttemptUsers,
            'impressionUsers' => $pageImpressionUsers,
            'linkedImpressionUsers' => $linkedImpressionUsers,
            'linked_impression_users' => $linkedImpressionUsers,
            'correlatedImpressionUsers' => $correlatedImpressionUsers,
            'correlated_impression_users' => $correlatedImpressionUsers,
            'impressionCorrelationSource' => $correlatedImpression->impression_correlation_source ?? null,
            'impression_correlation_source' => $correlatedImpression->impression_correlation_source ?? null,
            'eligibilityCheckCoverageRate' => $this->rate($eligibilityCheckUsers, $pageUsers),
            'eligibilityPassRate' => $this->rate($eligibleUsers, $eligibilityCheckUsers),
            'opportunityCompletenessRate' => $this->rate($pageOpportunityUsers, $eligibleUsers),
            'realtimeRequestStartRate' => $this->rate($requestUsers, $pageOpportunityUsers),
            'requestLoadSuccessRate' => $this->rate($requestSuccessUsers, $requestUsers),
            'request_load_success_rate' => $this->rate($requestSuccessUsers, $requestUsers),
            'requestLoadFailedRate' => $this->rate($requestFailedUsers, $requestUsers),
            'request_load_failed_rate' => $this->rate($requestFailedUsers, $requestUsers),
            'requestTerminalCompletenessRate' => $this->rate($requestTerminalUsers, $requestUsers),
            'request_terminal_completeness_rate' => $this->rate($requestTerminalUsers, $requestUsers),
            'showAttemptRate' => $this->rate($showAttemptUsers, $showAttemptBase),
            'impressionRate' => $this->rate($pageImpressionUsers, $showAttemptUsers),
            'eligibilityBlockedReasons' => collect($eligibilityReasons)->map(fn ($reason) => [
                'blockedReason' => (string) $reason->blocked_reason,
                'blockedUsers' => (int) $reason->blocked_users,
                'blockedSessions' => (int) $reason->blocked_sessions,
                'blockedEvents' => (int) $reason->blocked_events,
            ])->values()->all(),
            'viewerRate' => $this->rate($pageImpressionUsers, $pageUsers),
            'viewerRateAvailable' => $pageUsers > 0,
            'impressionCount' => (int) ($monetization->impression_count ?? 0),
            'revenue' => round(((int) ($monetization->revenue_micros ?? 0)) / 1000000, 6),
        ];
    }

    private function rate(int $numerator, int $denominator): float
    {
        return $denominator > 0 ? round($numerator * 100 / $denominator, 2) : 0;
    }

    private function summaryDistinctValues(
        string $column,
        int $limit = 100,
        bool $excludeEmptyString = true,
        string $table = 'dws_app_funnel_stage_daily'
    ): array
    {
        $query = DB::connection('adb')->table($table)
            ->where('stat_date', '<=', Carbon::now(config('app.timezone', 'Asia/Shanghai'))->toDateString())
            ->whereNotNull($column);

        if ($excludeEmptyString) {
            $query->where($column, '!=', '');
        }

        return $query->distinct()->orderBy($column)->limit($limit)->pluck($column)->values()->all();
    }

    private function summaryVersionOptions(): array
    {
        return DB::connection('adb')->table('dws_app_funnel_stage_daily')
            ->where('stat_date', '<=', Carbon::now(config('app.timezone', 'Asia/Shanghai'))->toDateString())
            ->whereNotNull('app_version')->where('app_version', '!=', '')
            ->select(['app_version', 'build_number'])->distinct()
            ->orderBy('app_version')->orderBy('build_number')->limit(200)->get()
            ->map(fn ($row) => [
                'appVersion' => $row->app_version,
                'buildNumber' => $row->build_number === null ? null : (int) $row->build_number,
            ])->all();
    }

    private function summarySourceTypeOptions(): array
    {
        $availability = DB::connection('adb')->table('dws_app_funnel_stage_daily')
            ->where('stat_date', '<=', Carbon::now(config('app.timezone', 'Asia/Shanghai'))->toDateString())
            ->selectRaw('MAX(CASE WHEN api_event_count > 0 THEN 1 ELSE 0 END) AS has_api')
            ->selectRaw('MAX(CASE WHEN firebase_event_count > 0 THEN 1 ELSE 0 END) AS has_firebase')
            ->selectRaw('MAX(CASE WHEN both_source_event_count > 0 THEN 1 ELSE 0 END) AS has_both')
            ->first();

        return array_values(array_filter([
            (int) ($availability?->has_api ?? 0) === 1 ? 'api' : null,
            (int) ($availability?->has_firebase ?? 0) === 1 ? 'firebase' : null,
            (int) ($availability?->has_both ?? 0) === 1 ? 'both' : null,
        ]));
    }

    private function distinctValues(string $column, int $limit = 100, bool $excludeEmptyString = true): array
    {
        $query = DB::connection('adb')->table($this->eventTable())
            ->whereNotNull($column);

        if ($excludeEmptyString) {
            $query->where($column, '!=', '');
        }

        return $query
            ->distinct()
            ->orderBy($column)
            ->limit($limit)
            ->pluck($column)
            ->values()
            ->all();
    }

    /**
     * Return only source filters backed by at least one standardized event row.
     */
    private function sourceTypeOptions(): array
    {
        $availability = DB::connection('adb')->table($this->eventTable())
            ->selectRaw('MAX(CASE WHEN api_seen = 1 THEN 1 ELSE 0 END) AS has_api')
            ->selectRaw('MAX(CASE WHEN firebase_seen = 1 THEN 1 ELSE 0 END) AS has_firebase')
            ->selectRaw('MAX(CASE WHEN api_seen = 1 AND firebase_seen = 1 THEN 1 ELSE 0 END) AS has_both')
            ->first();

        $options = [];
        if ((int) ($availability?->has_api ?? 0) === 1) {
            $options[] = 'api';
        }
        if ((int) ($availability?->has_firebase ?? 0) === 1) {
            $options[] = 'firebase';
        }
        if ((int) ($availability?->has_both ?? 0) === 1) {
            $options[] = 'both';
        }

        return $options;
    }

    private function eventTable(): string
    {
        return (string) config('adb.tracking_events.event_table', 'dwd_app_tracking_event');
    }

    private function normalizeTrackingEventName(string $eventName): string
    {
        $eventName = Str::lower(trim($eventName));
        $eventName = preg_replace('/[^a-z0-9_]/', '', $eventName) ?: '';
        return Str::startsWith($eventName, 'jk_') ? substr($eventName, 3) : $eventName;
    }

    /**
     * Build the immutable ADB scope used to calculate one issue's baseline or verification metric.
     */
    private function issueScope(object $issue, string $phase): ?array
    {
        $isVerification = $phase === 'verification';
        $dateFrom = $isVerification ? $issue->verify_start_date : $issue->baseline_start_date;
        $dateTo = $isVerification ? $issue->verify_end_date : $issue->baseline_end_date;
        if (!$dateFrom || !$dateTo) {
            return null;
        }

        $scope = [
            'dateFrom' => (string) $dateFrom,
            'dateTo' => (string) $dateTo,
            'projectCode' => (string) $issue->project_code,
            'appIdentifier' => (string) $issue->app_identifier,
            'compareType' => 'none',
            'domain' => 'ads',
            'unit' => 'users',
        ];
        if ($isVerification && !empty($issue->target_version)) {
            $scope['appVersion'] = (string) $issue->target_version;
        }

        return $scope;
    }

    /**
     * Calculate the configured issue metric from standardized ADB events instead of accepting a client value.
     */
    private function issueMetricForRecord(object $issue, string $phase): array
    {
        $scope = $this->issueScope($issue, $phase);
        if (!$scope) {
            return $this->unavailableIssueMetric(
                $issue->metric_code ?? null,
                $phase === 'verification' ? '尚未设置修复后验证区间' : '尚未设置修复前基线区间'
            );
        }
        if (empty($issue->metric_code)) {
            return $this->unavailableIssueMetric(null, '尚未选择效果验证指标', $scope);
        }

        return $this->calculateIssueMetric((string) $issue->metric_code, $scope);
    }

    /**
     * Evaluate one supported metric with the same aggregate formulas used by the funnel workbench.
     */
    private function calculateIssueMetric(string $metricCode, array $scope): array
    {
        $definition = collect(self::METRIC_DICTIONARY)->firstWhere('code', $metricCode);
        if (!$definition) {
            return $this->unavailableIssueMetric($metricCode, '不支持的效果验证指标', $scope);
        }

        try {
            $row = $this->aggregateQuery($scope)->first() ?: $this->emptyAggregate();
        } catch (Throwable) {
            return $this->unavailableIssueMetric($metricCode, 'ADB 标准事件明细暂时不可查询', $scope);
        }
        if ($row->latest_event_at === null) {
            return $this->unavailableIssueMetric($metricCode, '当前范围没有标准事件明细', $scope);
        }

        $summary = $this->formatSummary($row);
        $metric = match ($metricCode) {
            'dau' => $this->metric('dau', '日活跃用户数', $summary['dauUsers'], 'count', 'COUNT(DISTINCT my_user_id)，事件为 app_foreground'),
            'ad_viewer_rate' => $summary['dauUsers'] > 0
                ? $this->ratioMetric('ad_viewer_rate', '广告浏览者比例', $summary['impressionUsers'], $summary['dauUsers'], '广告展示独立用户 / DAU')
                : $this->unavailableMetric('ad_viewer_rate', '广告浏览者比例', '广告展示独立用户 / DAU', '当前范围没有 DAU'),
            'opportunity_coverage' => $summary['dauUsers'] > 0
                ? $this->ratioMetric('opportunity_coverage', 'Opportunity 覆盖率', $summary['opportunityUsers'], $summary['dauUsers'], '广告机会用户 / DAU')
                : $this->unavailableMetric('opportunity_coverage', 'Opportunity 覆盖率', '广告机会用户 / DAU', '当前范围没有 DAU'),
            'impressions_per_viewer' => $summary['impressionUsers'] > 0
                ? array_replace(
                    $this->metric('impressions_per_viewer', '人均展示次数', $summary['impressionsPerViewer'], 'decimal', 'ad_impression 事件数 / 广告展示独立用户'),
                    ['detail' => number_format($summary['impressionCount']) . ' / ' . number_format($summary['impressionUsers'])]
                )
                : $this->unavailableMetric('impressions_per_viewer', '人均展示次数', 'ad_impression 事件数 / 广告展示独立用户', '当前范围没有广告展示用户', 'decimal'),
            'revenue' => $this->metric('revenue', '广告收入', $summary['revenue'], 'currency', 'SUM(value_micros) / 1,000,000'),
            'fulfillment_rate' => $summary['opportunityCount'] > 0
                ? $this->ratioMetric('fulfillment_rate', '机会履约率', $summary['showAttemptCount'], $summary['opportunityCount'], 'ad_show_attempt 事件数 / ad_opportunity 事件数')
                : $this->unavailableMetric('fulfillment_rate', '机会履约率', 'ad_show_attempt 事件数 / ad_opportunity 事件数', '当前范围没有广告机会事件'),
            default => $this->unavailableMetric($metricCode, (string) $definition['name'], (string) $definition['formula'], '不支持的效果验证指标'),
        };

        return $metric + [
            'dateFrom' => $scope['dateFrom'],
            'dateTo' => $scope['dateTo'],
            'projectCode' => $scope['projectCode'],
            'appIdentifier' => $scope['appIdentifier'],
            'appVersion' => $scope['appVersion'] ?? null,
        ];
    }

    /** Return an explicit unavailable metric without converting missing data to zero. */
    private function unavailableIssueMetric(?string $metricCode, string $reason, array $scope = []): array
    {
        $definition = collect(self::METRIC_DICTIONARY)->firstWhere('code', $metricCode);

        return [
            'metricKey' => $metricCode,
            'name' => $definition['name'] ?? ($metricCode ?: '未配置指标'),
            'value' => null,
            'displayValue' => '暂无数据',
            'unit' => null,
            'formula' => $definition['formula'] ?? null,
            'source' => $definition['source'] ?? 'dwd_app_tracking_event',
            'detail' => $reason,
            'available' => false,
            'dateFrom' => $scope['dateFrom'] ?? null,
            'dateTo' => $scope['dateTo'] ?? null,
            'projectCode' => $scope['projectCode'] ?? null,
            'appIdentifier' => $scope['appIdentifier'] ?? null,
            'appVersion' => $scope['appVersion'] ?? null,
        ];
    }

    /** Read evidence rows linked to the selected issue without exposing raw snapshots. */
    private function issueEvidence(string $issueId): array
    {
        try {
            $query = DB::connection('adb')->table('ads_funnel_diagnosis_evidence')->where('issue_id', $issueId);
            $total = (clone $query)->count();
            $items = $query->orderByDesc('evidence_date')->orderByDesc('created_at')->limit(100)->get()->map(fn ($row) => [
                'evidenceId' => $row->evidence_id,
                'evidenceDate' => $row->evidence_date,
                'evidenceType' => $row->evidence_type,
                'eventId' => $row->event_id,
                'metricCode' => $row->metric_code,
                'summary' => $this->sanitizeEvidenceText($row->evidence_summary),
                'createdBy' => $row->created_by,
                'createdAt' => $row->created_at,
            ])->values()->all();
        } catch (Throwable) {
            return ['available' => false, 'items' => [], 'total' => 0];
        }

        return ['available' => true, 'items' => $items, 'total' => $total];
    }

    /** Resolve a client-selected event again in ADB so evidence fields cannot be forged by the browser. */
    private function resolveIssueEvidence(array $data): ?object
    {
        if (empty($data['evidenceEventId'])) {
            return null;
        }

        try {
            $event = DB::connection('adb')->table($this->eventTable())
                ->where('event_date', $data['evidenceDate'])
                ->where('event_id', $data['evidenceEventId'])
                ->where('project_code', $data['projectCode'])
                ->where('app_identifier', $data['appIdentifier'])
                ->first([
                    'event_id', 'event_date', 'event_time_utc', 'event_name', 'my_user_id', 'session_id',
                    'opportunity_id', 'request_id', 'ad_instance_id', 'screen_name', 'result_status',
                    'error_category', 'error_code', 'blocked_reason', 'quality_status',
                ]);
        } catch (Throwable) {
            throw new InvalidArgumentException('当前无法从 ADB 校验证据事件');
        }
        if (!$event) {
            throw new InvalidArgumentException('证据事件不存在或不属于当前项目和 App');
        }

        return $event;
    }

    /** Persist one server-verified event reference in the ADB diagnosis evidence table. */
    private function persistIssueEvidence(
        string $issueId,
        object $event,
        ?string $metricCode,
        int|string|null $actorId,
        Carbon $createdAt
    ): void {
        $isAdChain = str_starts_with((string) $event->event_name, 'ad_')
            || str_starts_with((string) $event->event_name, 'banner_');
        $summary = json_encode([
            'eventName' => $event->event_name,
            'eventTime' => $event->event_time_utc,
            'screenName' => $event->screen_name,
            'resultStatus' => $event->result_status,
            'errorCategory' => $event->error_category,
            'errorCode' => $event->error_code,
            'blockedReason' => $event->blocked_reason,
            'qualityStatus' => $event->quality_status,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        DB::connection('adb')->table('ads_funnel_diagnosis_evidence')->insert([
            'evidence_id' => 'FDE-' . Str::upper((string) Str::ulid()),
            'evidence_date' => $event->event_date,
            'issue_id' => $issueId,
            'evidence_type' => $isAdChain ? 'ad_chain' : 'event',
            'event_id' => $event->event_id,
            'my_user_id' => $event->my_user_id,
            'session_id' => $event->session_id,
            'opportunity_id' => $event->opportunity_id,
            'request_id' => $event->request_id,
            'ad_instance_id' => $event->ad_instance_id,
            'metric_code' => $metricCode,
            'evidence_summary' => $summary ?: '{}',
            'snapshot_json' => null,
            'created_by' => $actorId ? (string) $actorId : null,
            'created_at' => $createdAt,
        ]);
    }

    /** Build factual lifecycle entries from persisted issue timestamps. */
    private function issueActivities(object $issue): array
    {
        return collect([
            ['time' => $issue->created_at, 'status' => 'OPEN', 'content' => '诊断任务已创建', 'operator' => $issue->created_by],
            ['time' => $issue->fixed_at, 'status' => 'FIXED', 'content' => '修复已完成，等待验证', 'operator' => null],
            ['time' => $issue->verified_at, 'status' => 'VERIFIED', 'content' => '修复后指标已验证', 'operator' => null],
            ['time' => $issue->closed_at, 'status' => 'CLOSED', 'content' => '问题已关闭', 'operator' => null],
        ])->filter(fn (array $activity) => !empty($activity['time']))->values()->all();
    }

    /** Format a selected issue with live ADB baseline and verification calculations. */
    private function formatIssueDetail(object $row): array
    {
        $baselineMetric = $this->issueMetricForRecord($row, 'baseline');
        $verificationMetric = $this->issueMetricForRecord($row, 'verification');

        return array_replace($this->formatIssue($row), [
            'baselineMetricValue' => $baselineMetric['available'] ? $baselineMetric['value'] : null,
            'verifyMetricValue' => $verificationMetric['available'] ? $verificationMetric['value'] : null,
            'baselineMetricSnapshotValue' => $row->baseline_metric_value,
            'verifyMetricSnapshotValue' => $row->verify_metric_value,
            'baselineMetric' => $baselineMetric,
            'verificationMetric' => $verificationMetric,
        ]);
    }

    private function formatIssue(object $row): array
    {
        return [
            'issueId' => $row->issue_id,
            'projectCode' => $row->project_code,
            'appIdentifier' => $row->app_identifier,
            'funnelVersionId' => $row->funnel_version_id,
            'issueType' => $row->issue_type,
            'severity' => $row->severity,
            'status' => $row->status,
            'title' => $row->title,
            'description' => $row->description,
            'rootCause' => $row->root_cause,
            'fixPlan' => $row->fix_plan,
            'ownerId' => $row->owner_id,
            'targetVersion' => $row->target_version,
            'metricCode' => $row->metric_code,
            'baselineStartDate' => $row->baseline_start_date,
            'baselineEndDate' => $row->baseline_end_date,
            'verifyStartDate' => $row->verify_start_date,
            'verifyEndDate' => $row->verify_end_date,
            'baselineMetricValue' => $row->baseline_metric_value,
            'verifyMetricValue' => $row->verify_metric_value,
            'slaDueAt' => $row->sla_due_at,
            'fixedAt' => $row->fixed_at,
            'verifiedAt' => $row->verified_at,
            'closedAt' => $row->closed_at,
            'createdAt' => $row->created_at,
            'updatedAt' => $row->updated_at,
        ];
    }
}
