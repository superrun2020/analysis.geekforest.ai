<?php

namespace App\Console\Commands;

use App\Services\FunnelAnalyticsService;
use Carbon\Carbon;
use Illuminate\Console\Command;
use InvalidArgumentException;
use Throwable;

class WarmFunnelWorkbenchCache extends Command
{
    protected $signature = 'funnel-analysis:warm-workbench-cache
        {--date= : 预热日期 YYYY-MM-DD，不传默认昨天}
        {--project-code= : 只预热指定项目代号，多个用英文逗号分隔}
        {--domain=vpn : 预热领域：vpn、ads 或 all}
        {--platform=android : 默认预热平台：android、ios 或 all}
        {--limit=120 : 未指定项目时最多预热多少个 Firebase 已绑定项目}
        {--matrix : 同时预热广告网络失败横向报表缓存（近7天 / android）}
        {--force : 清掉同 key 旧缓存后重新查询}';

    protected $description = 'Warm JKCL funnel workbench caches from DWS summaries for Firebase-bound projects';

    public function handle(FunnelAnalyticsService $service): int
    {
        try {
            $date = $this->resolveDate();
            $domains = $this->resolveDomains();
            $projects = $this->resolveProjects($service);
        } catch (Throwable $error) {
            $this->error($error->getMessage());
            return self::FAILURE;
        }

        if ($projects === []) {
            $this->warn('没有找到可预热的 Firebase 绑定项目。');
            return self::SUCCESS;
        }

        $this->info(sprintf(
            '开始预热漏斗工作台缓存：date=%s domains=%s projects=%d force=%s',
            $date,
            implode(',', $domains),
            count($projects),
            $this->option('force') ? 'yes' : 'no'
        ));

        $success = 0;
        $failed = 0;
        foreach ($projects as $project) {
            foreach ($domains as $domain) {
                foreach ($this->platformsForProject($project) as $platform) {
                    $params = $this->buildWorkbenchParams($date, $domain, $project, $platform);
                    try {
                        $result = $service->warmWorkbenchCache($params, (bool) $this->option('force'));
                        $success++;
                        $this->line(sprintf(
                            '[OK] %s %s %s %s source=%s funnel=%d ttl=%ss elapsed=%dms latest=%s',
                            $result['projectCode'] ?: '-',
                            $result['appIdentifier'] ?: '-',
                            $result['platform'] ?: 'all-platform',
                            $domain,
                            $result['querySource'] ?: 'detail_or_default',
                            $result['funnelCount'],
                            $result['cacheTtlSeconds'] ?? '-',
                            $result['elapsedMs'],
                            $result['latestLoadedAt'] ?: '-'
                        ));
                    } catch (Throwable $error) {
                        $failed++;
                        $this->warn(sprintf(
                            '[FAIL] %s %s %s %s %s',
                            (string) ($project['projectCode'] ?? '-'),
                            (string) ($project['appIdentifier'] ?? '-'),
                            $platform ?: 'all-platform',
                            $domain,
                            $error->getMessage()
                        ));
                    }
                }
            }
        }

        $this->info(sprintf('预热完成：success=%d failed=%d', $success, $failed));

        if ($this->option('matrix')) {
            $matrixSuccess = 0;
            $matrixFailed = 0;
            $this->info('开始预热广告网络失败横向报表缓存（近7天 / android）...');
            foreach ($projects as $project) {
                $params = $this->buildMatrixParams($project);
                try {
                    $result = $service->warmNetworkFailureMatrix($params, (bool) $this->option('force'));
                    $matrixSuccess++;
                    $this->line(sprintf(
                        '[MATRIX OK] %s platform=%s available=%s rows=%d elapsed=%dms',
                        $result['projectCode'] ?: '-',
                        $result['platform'] ?: '-',
                        $result['available'] ? 'yes' : 'no',
                        $result['rows'],
                        $result['elapsedMs']
                    ));
                } catch (Throwable $error) {
                    $matrixFailed++;
                    $this->warn(sprintf(
                        '[MATRIX FAIL] %s %s',
                        (string) ($project['projectCode'] ?? '-'),
                        $error->getMessage()
                    ));
                }
            }
            $this->info(sprintf('横向报表预热完成：success=%d failed=%d', $matrixSuccess, $matrixFailed));
        }

        return $failed > 0 && $success === 0 ? self::FAILURE : self::SUCCESS;
    }

    private function resolveDate(): string
    {
        $timezone = (string) config('app.timezone', 'Asia/Shanghai');
        $date = trim((string) ($this->option('date') ?? ''));
        if ($date === '') {
            return Carbon::now($timezone)->subDay()->toDateString();
        }
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
            throw new InvalidArgumentException('--date 必须是 YYYY-MM-DD。');
        }

        return Carbon::createFromFormat('Y-m-d', $date, $timezone)->toDateString();
    }

    /** @return array<int, string> */
    private function resolveDomains(): array
    {
        $domain = strtolower(trim((string) ($this->option('domain') ?? 'vpn')));
        return match ($domain) {
            'vpn' => ['vpn'],
            'ads' => ['ads'],
            'all' => ['vpn', 'ads'],
            default => throw new InvalidArgumentException('--domain 只能是 vpn、ads 或 all。'),
        };
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function resolveProjects(FunnelAnalyticsService $service): array
    {
        $projects = $service->projects();
        $projectOption = trim((string) ($this->option('project-code') ?? ''));
        if ($projectOption !== '') {
            $wanted = array_values(array_unique(array_filter(array_map(
                static fn (string $code): string => trim($code),
                explode(',', $projectOption)
            ))));
            $projects = array_values(array_filter($projects, function (array $project) use ($wanted): bool {
                $code = (string) ($project['projectCode'] ?? '');
                return in_array($code, $wanted, true) || in_array(preg_replace('/^A/i', '', $code), $wanted, true);
            }));
        }

        $limit = max(1, min(1000, (int) ($this->option('limit') ?: 120)));

        return array_slice($projects, 0, $limit);
    }

    /**
     * @param array<string, mixed> $project
     * @return array<int, string|null>
     */
    private function platformsForProject(array $project): array
    {
        $platformOption = strtolower(trim((string) ($this->option('platform') ?? 'android')));
        if ($platformOption === 'all') {
            return [null];
        }
        if (!in_array($platformOption, ['android', 'ios'], true)) {
            throw new InvalidArgumentException('--platform 只能是 android、ios 或 all。');
        }

        $platforms = [$platformOption];
        $projectPlatform = strtolower(trim((string) ($project['platform'] ?? '')));
        if (in_array($projectPlatform, ['android', 'ios'], true) && !in_array($projectPlatform, $platforms, true)) {
            $platforms[] = $projectPlatform;
        }

        return $platforms;
    }

    /**
     * Use the same request shape as the production React package loader, so the
     * scheduled cache is hit when operators open the page.
     *
     * @param array<string, mixed> $project
     * @return array<string, mixed>
     */
    private function buildWorkbenchParams(string $date, string $domain, array $project, ?string $platform): array
    {
        $params = [
            'dateFrom' => $date,
            'dateTo' => $date,
            'projectCode' => (string) ($project['projectCode'] ?? ''),
            'page' => 'workbench',
            'domain' => $domain,
            'unit' => $domain === 'vpn' ? 'sessions' : 'users',
            'evidenceMode' => 'ad',
            'pageSize' => 50,
        ];

        $appIdentifier = trim((string) ($project['appIdentifier'] ?? ''));
        if ($appIdentifier !== '') {
            $params['appIdentifier'] = $appIdentifier;
        }
        if ($platform !== null && $platform !== '') {
            $params['platform'] = $platform;
        }

        return $params;
    }

    /**
     * Match the frontend default for the ad network failure matrix tab: last 7
     * days (excluding today, whose DWD detail is still arriving), Android, all
     * countries/versions.
     *
     * @param array<string, mixed> $project
     * @return array<string, mixed>
     */
    private function buildMatrixParams(array $project): array
    {
        $timezone = (string) config('app.timezone', 'Asia/Shanghai');
        $params = [
            'dateFrom' => Carbon::now($timezone)->subDays(7)->toDateString(),
            'dateTo' => Carbon::now($timezone)->subDay()->toDateString(),
            'projectCode' => (string) ($project['projectCode'] ?? ''),
            'platform' => 'android',
            'evidenceMode' => 'ad',
            'pageSize' => 50,
        ];

        $appIdentifier = trim((string) ($project['appIdentifier'] ?? ''));
        if ($appIdentifier !== '') {
            $params['appIdentifier'] = $appIdentifier;
        }

        return $params;
    }
}
