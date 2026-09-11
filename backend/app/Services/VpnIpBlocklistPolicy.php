<?php

namespace App\Services;

class VpnIpBlocklistPolicy
{
    /**
     * @param array<string, mixed> $rule
     * @param array<string, mixed> $metrics
     * @return array{level: string, reason: string, ttl_minutes: int, error_session_rate: float}
     */
    public function evaluate(array $rule, array $metrics): array
    {
        $requestSessions = max(0, (int) ($metrics['request_sessions'] ?? 0));
        $errorSessions = max(0, (int) ($metrics['internal_error_sessions'] ?? 0));
        $successSessions = max(0, (int) ($metrics['success_sessions'] ?? 0));
        $lastSuccessAgeMinutes = $metrics['last_success_age_minutes'] ?? null;
        $rate = $requestSessions > 0 ? $errorSessions / $requestSessions : 0.0;

        if ($requestSessions < (int) ($rule['min_request_sessions'] ?? 5)) {
            return $this->decision('none', '样本 session 数不足', 0, $rate);
        }

        if ($this->matchesHardBlock($rule, $requestSessions, $errorSessions, $successSessions, $rate, $lastSuccessAgeMinutes)) {
            return $this->decision('hard_block', '错误率达到强黑名单阈值且近期无成功', (int) ($rule['hard_block_ttl_minutes'] ?? 360), $rate);
        }

        if ($this->matchesBlocked($rule, $requestSessions, $errorSessions, $successSessions, $rate)) {
            return $this->decision('blocked', '错误率达到黑名单阈值且无成功 session', (int) ($rule['blocked_ttl_minutes'] ?? 60), $rate);
        }

        if ($this->matchesSuspect($rule, $requestSessions, $errorSessions, $rate)) {
            return $this->decision('suspect', '错误率达到灰名单阈值', (int) ($rule['suspect_ttl_minutes'] ?? 30), $rate);
        }

        return $this->decision('none', '未达到灰名单阈值', 0, $rate);
    }

    private function matchesHardBlock(array $rule, int $requestSessions, int $errorSessions, int $successSessions, float $rate, mixed $lastSuccessAgeMinutes): bool
    {
        return $requestSessions >= (int) ($rule['hard_block_min_request_sessions'] ?? 10)
            && $errorSessions >= (int) ($rule['hard_block_min_error_sessions'] ?? 8)
            && $rate >= (float) ($rule['hard_block_min_error_rate'] ?? 0.9)
            && $successSessions === 0;
    }

    private function matchesBlocked(array $rule, int $requestSessions, int $errorSessions, int $successSessions, float $rate): bool
    {
        return $requestSessions >= (int) ($rule['blocked_min_request_sessions'] ?? 8)
            && $errorSessions >= (int) ($rule['blocked_min_error_sessions'] ?? 5)
            && $rate >= (float) ($rule['blocked_min_error_rate'] ?? 0.8)
            && $successSessions <= (int) ($rule['blocked_max_success_sessions'] ?? 0);
    }

    private function matchesSuspect(array $rule, int $requestSessions, int $errorSessions, float $rate): bool
    {
        return $requestSessions >= (int) ($rule['suspect_min_request_sessions'] ?? 5)
            && $errorSessions >= (int) ($rule['suspect_min_error_sessions'] ?? 3)
            && $rate >= (float) ($rule['suspect_min_error_rate'] ?? 0.5);
    }

    /** @return array{level: string, reason: string, ttl_minutes: int, error_session_rate: float} */
    private function decision(string $level, string $reason, int $ttlMinutes, float $rate): array
    {
        return [
            'level' => $level,
            'reason' => $reason,
            'ttl_minutes' => $ttlMinutes,
            'error_session_rate' => round($rate, 6),
        ];
    }
}
