<?php

namespace App\Console\Commands;

use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use Throwable;

class ResolveDomainAsn extends Command
{
    protected $signature = 'funnel-analysis:resolve-domain-asn
        {--project-code=A003 : 项目代号}
        {--days=7 : 从事件表取最近几天出现过的域名}';

    protected $description = 'Resolve VPN node domains to IP addresses and ASN metadata';

    public function handle(): int
    {
        try {
            $projectCode = $this->resolveProjectCode();
            $days = $this->resolveDays();
            $this->createTable();
            $domains = $this->loadDomains($projectCode, $days);
        } catch (Throwable $error) {
            $this->error($error->getMessage());
            return self::FAILURE;
        }

        $this->info(sprintf(
            '开始解析 VPN 节点域名：project=%s days=%d domains=%d',
            $projectCode,
            $days,
            count($domains)
        ));

        $ipCount = 0;
        $asnSuccess = 0;
        $asnFailed = 0;

        foreach ($domains as $domain) {
            $ips = $this->resolveDomainIps($domain);
            $ipCount += count($ips);

            if ($ips === []) {
                $this->warn(sprintf('[DNS FAIL] %s', $domain));
                continue;
            }

            $this->line(sprintf('[DNS OK] %s -> %s', $domain, implode(', ', $ips)));

            foreach ($ips as $ip) {
                if ($this->isPrivateIp($ip)) {
                    $this->line(sprintf('[ASN SKIP] %s 为私网 IP', $ip));
                    continue;
                }

                try {
                    $asn = $this->lookupAsn($ip);
                    if ($asn === null) {
                        $asnFailed++;
                        $this->warn(sprintf('[ASN FAIL] %s (%s)', $ip, $domain));
                        continue;
                    }

                    $this->storeResult($projectCode, $domain, $ip, $asn);
                    $asnSuccess++;
                    $this->line(sprintf('[ASN OK] %s %s %s', $ip, $asn['asn'] ?: '-', $asn['asn_name'] ?: '-'));
                } catch (Throwable $error) {
                    $asnFailed++;
                    $this->warn(sprintf('[ASN FAIL] %s (%s): %s', $ip, $domain, $error->getMessage()));
                } finally {
                    sleep(1);
                }
            }
        }

        $this->info(sprintf(
            '解析完成：domains=%d ips=%d asn_success=%d asn_failed=%d',
            count($domains),
            $ipCount,
            $asnSuccess,
            $asnFailed
        ));

        return self::SUCCESS;
    }

    private function resolveProjectCode(): string
    {
        $projectCode = trim((string) ($this->option('project-code') ?? ''));
        if ($projectCode === '') {
            throw new InvalidArgumentException('--project-code 不能为空。');
        }
        if (strlen($projectCode) > 32) {
            throw new InvalidArgumentException('--project-code 不能超过 32 个字符。');
        }

        return $projectCode;
    }

    private function resolveDays(): int
    {
        $daysOption = trim((string) ($this->option('days') ?? ''));
        if (filter_var($daysOption, FILTER_VALIDATE_INT) === false || (int) $daysOption < 1) {
            throw new InvalidArgumentException('--days 必须是大于 0 的整数。');
        }

        return (int) $daysOption;
    }

    private function createTable(): void
    {
        DB::statement(<<<'SQL'
CREATE TABLE IF NOT EXISTS jkcl_vpn_domain_asn (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    project_code VARCHAR(32) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    ip VARCHAR(64) NOT NULL,
    asn VARCHAR(32) NULL,
    asn_name VARCHAR(191) NULL,
    isp VARCHAR(191) NULL,
    org VARCHAR(191) NULL,
    country VARCHAR(64) NULL,
    resolved_at DATETIME NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_domain_ip (project_code, domain, ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
SQL);
    }

    /** @return array<int, string> */
    private function loadDomains(string $projectCode, int $days): array
    {
        $timezone = (string) config('adb.tracking_events.default_timezone', 'Asia/Shanghai');
        $startDate = Carbon::now($timezone)->subDays($days - 1)->toDateString();
        $eventTable = (string) config('adb.tracking_events.event_table', 'dwd_app_tracking_event_v18');

        return DB::connection('adb')->table($eventTable)
            ->where('project_code', $projectCode)
            ->where('event_date', '>=', $startDate)
            ->whereNotNull('server_id')
            ->where('server_id', '<>', '')
            ->distinct()
            ->pluck('server_id')
            ->map(static fn ($value): string => trim((string) $value))
            ->filter(static fn (string $value): bool => $value !== ''
                && strlen($value) <= 255
                && filter_var($value, FILTER_VALIDATE_IP) === false)
            ->unique()
            ->values()
            ->all();
    }

    /** @return array<int, string> */
    private function resolveDomainIps(string $domain): array
    {
        try {
            $ips = @gethostbynamel($domain);
        } catch (Throwable) {
            return [];
        }

        if (!is_array($ips)) {
            return [];
        }

        return array_values(array_unique(array_filter(
            $ips,
            static fn ($ip): bool => is_string($ip) && filter_var($ip, FILTER_VALIDATE_IP) !== false
        )));
    }

    /**
     * @return array{asn: string|null, asn_name: string|null, isp: string|null, org: string|null, country: string|null}|null
     */
    private function lookupAsn(string $ip): ?array
    {
        $url = 'http://ip-api.com/json/' . rawurlencode($ip) . '?fields=as,isp,org,country';
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 5,
                'ignore_errors' => true,
            ],
        ]);
        $response = @file_get_contents($url, false, $context);
        if (!is_string($response) || $response === '') {
            return null;
        }

        $payload = json_decode($response, true);
        if (!is_array($payload)) {
            return null;
        }

        $as = trim((string) ($payload['as'] ?? ''));
        if ($as === '' || preg_match('/^(AS\d+)(?:\s+(.*))?$/i', $as, $matches) !== 1) {
            return null;
        }

        return [
            'asn' => strtoupper($matches[1]),
            'asn_name' => $this->nullableString($matches[2] ?? null, 191),
            'isp' => $this->nullableString($payload['isp'] ?? null, 191),
            'org' => $this->nullableString($payload['org'] ?? null, 191),
            'country' => $this->nullableString($payload['country'] ?? null, 64),
        ];
    }

    private function isPrivateIp(string $ip): bool
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
            return false;
        }

        $value = ip2long($ip);
        if ($value === false) {
            return false;
        }
        $value = (int) sprintf('%u', $value);

        foreach ([
            ['10.0.0.0', '10.255.255.255'],
            ['172.16.0.0', '172.31.255.255'],
            ['192.168.0.0', '192.168.255.255'],
            ['127.0.0.0', '127.255.255.255'],
            ['169.254.0.0', '169.254.255.255'],
        ] as [$start, $end]) {
            if ($value >= (int) sprintf('%u', ip2long($start)) && $value <= (int) sprintf('%u', ip2long($end))) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array{asn: string|null, asn_name: string|null, isp: string|null, org: string|null, country: string|null} $asn
     */
    private function storeResult(string $projectCode, string $domain, string $ip, array $asn): void
    {
        DB::statement(
            <<<'SQL'
INSERT INTO jkcl_vpn_domain_asn
    (project_code, domain, ip, asn, asn_name, isp, org, country, resolved_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    asn = VALUES(asn),
    asn_name = VALUES(asn_name),
    isp = VALUES(isp),
    org = VALUES(org),
    country = VALUES(country),
    resolved_at = VALUES(resolved_at)
SQL,
            [
                $projectCode,
                $domain,
                $ip,
                $asn['asn'],
                $asn['asn_name'],
                $asn['isp'],
                $asn['org'],
                $asn['country'],
                Carbon::now()->toDateTimeString(),
            ]
        );
    }

    private function nullableString(mixed $value, int $maxLength): ?string
    {
        $value = trim((string) ($value ?? ''));
        if ($value === '') {
            return null;
        }

        return function_exists('mb_substr') ? mb_substr($value, 0, $maxLength) : substr($value, 0, $maxLength);
    }
}
