<?php

namespace App\Console\Commands;

use App\Services\FunnelAnalyticsAggregateService;
use Carbon\Carbon;
use Illuminate\Console\Command;
use InvalidArgumentException;
use Throwable;

class AggregateFunnelAnalytics extends Command
{
    protected $signature = 'funnel-analysis:aggregate
        {--start-date= : 开始日期 YYYY-MM-DD，不传时按 lookback-days 回刷}
        {--end-date= : 结束日期 YYYY-MM-DD，不传时默认今天}
        {--project-code= : 只重算指定项目代号}
        {--lookback-days= : 未指定 start-date 时回刷最近 N 天}
        {--tables= : 只重算指定聚合表配置 key，逗号分隔}
        {--force : 忽略 ADB_FUNNEL_AGGREGATE_ENABLED 开关}';

    protected $description = 'Rebuild JKCL funnel, ad, VPN, quality and screen-path aggregates from ADB detail events';

    /**
     * 执行漏斗分析九张聚合表的日期范围重算。
     */
    public function handle(FunnelAnalyticsAggregateService $service): int
    {
        if (!config('adb.funnel_aggregates.enabled') && !$this->option('force')) {
            $this->warn('ADB 漏斗聚合任务未启用；手动执行可增加 --force。');
            return self::SUCCESS;
        }

        try {
            [$startDate, $endDate] = $this->resolveDateRange();
            $projectCode = trim((string) ($this->option('project-code') ?? '')) ?: null;
            $tableKeys = $this->resolveTableKeys($service);
            $stats = $service->aggregate(
                $startDate,
                $endDate,
                $projectCode,
                $tableKeys,
                function (array $progress): void {
                    $this->renderProgress($progress);
                }
            );
        } catch (Throwable $error) {
            $this->error($error->getMessage());
            return self::FAILURE;
        }

        $this->info(sprintf(
            'funnel aggregates rebuilt: %s - %s project=%s tables=%s dates=%d rows=%d',
            $stats['startDate'],
            $stats['endDate'],
            $stats['projectCode'] ?: 'all',
            implode(',', $stats['requestedTables']),
            $stats['dates'],
            array_sum($stats['tableRows'])
        ));

        foreach ($stats['tableRows'] as $table => $rows) {
            $this->line(sprintf('  %s: %d', $table, $rows));
        }

        return self::SUCCESS;
    }

    /** @return array{0: string, 1: string} */
    private function resolveDateRange(): array
    {
        $timezone = (string) config('adb.tracking_events.default_timezone', 'Asia/Shanghai');
        $end = $this->parseDate(
            trim((string) ($this->option('end-date') ?? '')) ?: Carbon::now($timezone)->toDateString(),
            'end-date',
            $timezone
        );
        $startOption = trim((string) ($this->option('start-date') ?? ''));
        if ($startOption !== '') {
            $start = $this->parseDate($startOption, 'start-date', $timezone);
        } else {
            $days = (int) ($this->option('lookback-days') ?: config('adb.funnel_aggregates.default_lookback_days', 3));
            $start = $end->copy()->subDays(max(1, min(3650, $days)) - 1);
        }

        if ($start->gt($end)) {
            throw new InvalidArgumentException('--start-date 不能晚于 --end-date。');
        }

        return [$start->toDateString(), $end->toDateString()];
    }

    /** @return array<int, string>|null */
    private function resolveTableKeys(FunnelAnalyticsAggregateService $service): ?array
    {
        $option = trim((string) ($this->option('tables') ?? ''));
        if ($option === '') {
            return null;
        }

        $keys = array_values(array_unique(array_filter(
            array_map(static fn (string $key): string => trim($key), explode(',', $option)),
            static fn (string $key): bool => $key !== ''
        )));
        if ($keys === []) {
            return null;
        }

        $available = $service->tableKeys();
        $invalid = array_values(array_diff($keys, $available));
        if ($invalid !== []) {
            throw new InvalidArgumentException(sprintf(
                '--tables 包含未知聚合表 key：%s。可选值：%s',
                implode(',', $invalid),
                implode(',', $available)
            ));
        }

        return $keys;
    }

    private function parseDate(string $date, string $option, string $timezone): Carbon
    {
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
            throw new InvalidArgumentException("--{$option} 日期格式必须是 YYYY-MM-DD。");
        }

        return Carbon::createFromFormat('Y-m-d', $date, $timezone)->startOfDay();
    }

    /**
     * 输出日期、目标表和 DWM 漏斗步骤进度，便于识别耗时或失败位置。
     *
     * @param array<string, mixed> $progress
     */
    private function renderProgress(array $progress): void
    {
        $event = (string) ($progress['event'] ?? '');
        $date = (string) ($progress['date'] ?? '');
        if ($event === 'run_skipped') {
            $this->warn('已有漏斗聚合正在执行，本次任务跳过');
            return;
        }
        if ($event === 'date_started') {
            $this->info("[{$date}] 开始重建");
            return;
        }
        if ($event === 'date_skipped') {
            $this->warn("[{$date}] 已有聚合任务持有日期锁，跳过");
            return;
        }
        if ($event === 'table_started') {
            $this->line(sprintf('[%s] 开始表 %s', $date, $progress['table']));
            return;
        }
        if ($event === 'stage_started') {
            $this->line(sprintf(
                '[%s]   漏斗步骤 %s.%s (#%d)',
                $date,
                $progress['funnel'],
                $progress['step'],
                $progress['step_order']
            ));
            return;
        }
        if ($event === 'stage_finished') {
            $this->line(sprintf(
                '[%s]   完成步骤 %s.%s rows=%d elapsed=%.2fs',
                $date,
                $progress['funnel'],
                $progress['step'],
                $progress['rows'],
                $progress['elapsed_seconds']
            ));
            return;
        }
        if ($event === 'table_finished') {
            $this->line(sprintf(
                '[%s] 完成表 %s rows=%d elapsed=%.2fs',
                $date,
                $progress['table'],
                $progress['rows'],
                $progress['elapsed_seconds']
            ));
            return;
        }
        if ($event === 'date_finished') {
            $this->info(sprintf(
                '[%s] 重建完成 rows=%d elapsed=%.2fs',
                $date,
                $progress['rows'],
                $progress['elapsed_seconds']
            ));
        }
    }
}
