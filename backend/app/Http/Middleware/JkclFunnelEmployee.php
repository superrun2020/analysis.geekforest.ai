<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Symfony\Component\HttpFoundation\Response;

class JkclFunnelEmployee
{
    /** Validate the OA bearer token and attach a narrowly scoped employee identity. */
    public function handle(Request $request, Closure $next): Response
    {
        $origin = rtrim((string) $request->headers->get('Origin'), '/');
        $allowedOrigins = array_map(
            fn (string $allowed): string => rtrim($allowed, '/'),
            (array) config('services.jkcl_funnel.allowed_origins', [])
        );
        if ($origin !== '' && !in_array($origin, $allowedOrigins, true)) {
            return response()->json(['ok' => false, 'error' => 'origin_forbidden'], 403);
        }

        $token = $request->bearerToken();
        if (!$token) {
            return response()->json(['ok' => false, 'error' => 'unauthenticated'], 401);
        }

        try {
            $identity = Cache::remember(
                'jkcl_funnel_identity:' . hash('sha256', $token),
                max(1, (int) config('services.jkcl_funnel.identity_cache_seconds', 60)),
                fn (): array => $this->loadIdentity($token)
            );
        } catch (ConnectionException) {
            return response()->json(['ok' => false, 'error' => 'identity_provider_unavailable'], 503);
        }

        if (($identity['ok'] ?? false) !== true) {
            return response()->json([
                'ok' => false,
                'error' => $identity['error'] ?? 'forbidden',
            ], (int) ($identity['status'] ?? 403));
        }

        $request->attributes->set('jkclEmployee', $identity['user']);
        $request->attributes->set('jkclAllowedProjectCodes', $this->allowedProjectCodes($identity['user']['email']));

        return $next($request);
    }

    /** Ask OA to re-apply the JKCL audience rule; a generic OA session is not sufficient. */
    private function loadIdentity(string $token): array
    {
        $baseUrl = rtrim((string) config('services.jkcl_funnel.oa_base_url'), '/');
        $response = Http::acceptJson()
            ->withToken($token)
            ->timeout(max(1, (int) config('services.jkcl_funnel.oa_timeout_seconds', 8)))
            ->get($baseUrl . '/api/auth/me', ['audience' => 'jkcl_funnel']);

        if (!$response->successful()) {
            $status = $response->status() === 401 ? 401 : ($response->status() >= 500 ? 503 : 403);
            return ['ok' => false, 'status' => $status, 'error' => $response->json('error') ?: 'forbidden'];
        }

        $user = $response->json('user');
        $email = strtolower(trim((string) ($user['email'] ?? '')));
        if (!str_ends_with($email, '@geekforest.ai')) {
            return ['ok' => false, 'status' => 403, 'error' => 'company_email_required'];
        }

        return ['ok' => true, 'user' => array_replace((array) $user, ['email' => $email])];
    }

    /** Resolve explicit per-employee access, falling back to the documented wildcard policy. */
    private function allowedProjectCodes(string $email): array
    {
        $access = (array) config('services.jkcl_funnel.project_access', []);
        $codes = $access[strtolower($email)] ?? $access['*'] ?? [];

        return array_values(array_unique(array_filter(array_map('strval', (array) $codes))));
    }
}
