<?php

namespace App\Http\Controllers\V3;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\FunnelDateSessionSummaryRequest;
use App\Http\Requests\Admin\FunnelAnalyticsQueryRequest;
use App\Http\Requests\Admin\FunnelDiagnosisIssueStoreRequest;
use App\Http\Requests\Admin\FunnelDiagnosisIssueUpdateRequest;
use App\Services\FunnelAnalyticsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;

class JkclFunnelController extends Controller
{
    public function __construct(private readonly FunnelAnalyticsService $service)
    {
    }

    /** Return the authenticated employee and effective project scope for UI bootstrapping. */
    public function session(Request $request): JsonResponse
    {
        return $this->ok([
            'user' => $request->attributes->get('jkclEmployee'),
            'projectScope' => $request->attributes->get('jkclAllowedProjectCodes', []),
        ]);
    }

    /** Return only projects the current employee may operate. */
    public function options(Request $request): JsonResponse
    {
        $data = $this->service->options();
        $allowed = $request->attributes->get('jkclAllowedProjectCodes', []);
        if (!in_array('*', $allowed, true)) {
            $data['projects'] = array_values(array_filter(
                $data['projects'] ?? [],
                fn (array $project): bool => in_array((string) ($project['projectCode'] ?? ''), $allowed, true)
            ));
        }

        return $this->ok($data);
    }

    /** Return the lightweight project selector for initial page rendering. */
    public function projects(Request $request): JsonResponse
    {
        $projects = $this->service->projects();
        $allowed = $request->attributes->get('jkclAllowedProjectCodes', []);
        if (!in_array('*', $allowed, true)) {
            $projects = array_values(array_filter(
                $projects,
                fn (array $project): bool => in_array((string) ($project['projectCode'] ?? ''), $allowed, true)
            ));
        }

        return $this->ok(['projects' => $projects]);
    }

    /** Return daily session data volume for the date selector. */
    public function dateSessionSummary(FunnelDateSessionSummaryRequest $request): JsonResponse
    {
        $data = $request->validated();
        $projectCode = $data['projectCode'] ?? null;
        if ($projectCode) {
            $projectCode = $this->service->resolveProjectCode($projectCode);
            $data['projectCode'] = $projectCode;
        }
        if ($projectCode && ($denied = $this->projectDenied($request, $projectCode))) {
            return $denied;
        }

        $allowed = $request->attributes->get('jkclAllowedProjectCodes', []);
        if (!$projectCode && !in_array('*', $allowed, true)) {
            $data['projectCodes'] = $allowed;
        }

        return $this->ok($this->service->dateSessionSummary($data));
    }

    /** Query one page after enforcing project scope on the server. */
    public function query(FunnelAnalyticsQueryRequest $request): JsonResponse
    {
        $data = $request->validated();
        $projectCode = $data['projectCode'] ?? null;
        if ($projectCode) {
            $projectCode = $this->service->resolveProjectCode($projectCode);
            $data['projectCode'] = $projectCode;
        }
        if ($projectCode && ($denied = $this->projectDenied($request, $projectCode))) {
            return $denied;
        }

        $allowed = $request->attributes->get('jkclAllowedProjectCodes', []);
        if (!$projectCode && !in_array('*', $allowed, true)) {
            $data['projectCodes'] = $allowed;
        }

        return $this->ok($this->service->query($data));
    }

    /** Generate an AI diagnosis report and return a password-protected public share link. */
    public function aiAnalysis(Request $request): JsonResponse
    {
        $data = $request->validate([
            'context' => 'nullable|array',
            'currentIssues' => 'nullable|array',
            'metrics' => 'nullable|array|max:30',
            'funnel' => 'nullable|array|max:40',
            'transitions' => 'nullable|array|max:40',
            'pagePathTop' => 'nullable|array|max:30',
            'diagnosisReasons' => 'nullable|array|max:30',
            'ask' => 'nullable|string|max:1000',
        ]);

        $projectCode = (string) data_get($data, 'context.projectCode', '');
        if ($projectCode !== '' && ($denied = $this->projectDenied($request, $projectCode))) {
            return $denied;
        }

        try {
            return $this->ok($this->service->generateAiAnalysis(
                $data,
                (string) data_get($request->attributes->get('jkclEmployee'), 'email'),
                (string) $request->input('frontendBaseUrl', $request->headers->get('origin', ''))
            ));
        } catch (InvalidArgumentException $exception) {
            return response()->json(['code' => 422, 'msg' => $exception->getMessage(), 'data' => null], 422);
        }
    }

    /** Check whether expected tracking events were received for one project/date. */
    public function trackingEventCoverage(Request $request): JsonResponse
    {
        $data = $request->validate([
            'projectCode' => 'required|string|max:64',
            'appIdentifier' => 'nullable|string|max:191',
            'date' => 'required|date',
            'eventNames' => 'required|array|min:1|max:200',
            'eventNames.*' => 'required|string|max:100',
        ]);

        if ($denied = $this->projectDenied($request, (string) $data['projectCode'])) {
            return $denied;
        }

        return $this->ok($this->service->trackingEventCoverage($data));
    }

    /** Create short-lived public Codex query links for ad/VPN tracking diagnostics. */
    public function createCodexQueryLinks(Request $request): JsonResponse
    {
        $data = $request->validate([
            'projectCode' => 'required|string|max:64',
            'appIdentifier' => 'nullable|string|max:191',
            'dateFrom' => 'required|date_format:Y-m-d',
            'dateTo' => 'required|date_format:Y-m-d|after_or_equal:dateFrom',
            'platform' => 'nullable|string|in:android,ios,Android,iOS',
            'country' => 'nullable|string|max:64',
            'appVersion' => 'nullable|string|max:64',
            'apiBaseUrl' => 'nullable|string|max:255',
        ]);

        $data['projectCode'] = $this->service->resolveProjectCode((string) $data['projectCode']);
        if ($denied = $this->projectDenied($request, (string) $data['projectCode'])) {
            return $denied;
        }

        try {
            return $this->ok($this->service->createCodexQueryLinks(
                $data,
                (string) data_get($request->attributes->get('jkclEmployee'), 'email'),
                (string) $request->input('apiBaseUrl', $request->root())
            ));
        } catch (InvalidArgumentException $exception) {
            return response()->json(['code' => 422, 'msg' => $exception->getMessage(), 'data' => null], 422);
        }
    }

    /** Public Codex-readable ad tracking diagnosis JSON, protected by a signed link or Codex bearer token. */
    public function codexAdsTracking(Request $request): JsonResponse
    {
        try {
            return $this->ok($this->service->codexTrackingQuery(
                'ads',
                $request->query(),
                $request->bearerToken(),
                $request->ip(),
                (string) $request->userAgent()
            ));
        } catch (InvalidArgumentException $exception) {
            return response()->json(['code' => 403, 'msg' => $exception->getMessage(), 'data' => null], 403);
        }
    }

    /** Public Codex-readable VPN tracking diagnosis JSON, protected by a signed link or Codex bearer token. */
    public function codexVpnTracking(Request $request): JsonResponse
    {
        try {
            return $this->ok($this->service->codexTrackingQuery(
                'vpn',
                $request->query(),
                $request->bearerToken(),
                $request->ip(),
                (string) $request->userAgent()
            ));
        } catch (InvalidArgumentException $exception) {
            return response()->json(['code' => 403, 'msg' => $exception->getMessage(), 'data' => null], 403);
        }
    }

    /** Create a fixed snapshot share link for the current project analysis page. */
    public function createProjectReportShare(Request $request): JsonResponse
    {
        $data = $request->validate([
            'title' => 'nullable|string|max:191',
            'module' => 'nullable|string|max:32',
            'page' => 'nullable|string|max:32',
            'projectCode' => 'nullable|string|max:64',
            'snapshot' => 'required|array',
            'frontendBaseUrl' => 'nullable|string|max:255',
        ]);

        $projectCode = (string) ($data['projectCode'] ?? data_get($data, 'snapshot.context.projectCode', data_get($data, 'snapshot.projectCode', '')));
        if ($projectCode !== '' && $projectCode !== '全部项目' && ($denied = $this->projectDenied($request, $projectCode))) {
            return $denied;
        }

        try {
            return $this->ok($this->service->createProjectReportShare(
                $data,
                (string) data_get($request->attributes->get('jkclEmployee'), 'email'),
                (string) $request->input('frontendBaseUrl', $request->headers->get('origin', ''))
            ));
        } catch (InvalidArgumentException $exception) {
            return response()->json(['code' => 422, 'msg' => $exception->getMessage(), 'data' => null], 422);
        }
    }

    /** Public project report metadata; requires only the opaque share id. */
    public function projectReportShareMeta(string $shareId): JsonResponse
    {
        $data = $this->service->projectReportShareMeta($shareId);
        if (!$data) {
            return response()->json(['code' => 404, 'msg' => '分享链接不存在或已删除', 'data' => null], 404);
        }

        return $this->ok($data);
    }

    /** Public project report open; requires company email and records access evidence. */
    public function openProjectReportShare(Request $request, string $shareId): JsonResponse
    {
        $data = $request->validate([
            'email' => 'required|email|max:191',
            'deviceInfo' => 'nullable|array',
        ]);

        try {
            return $this->ok($this->service->openProjectReportShare(
                $shareId,
                (string) $data['email'],
                is_array($data['deviceInfo'] ?? null) ? $data['deviceInfo'] : [],
                $request->ip(),
                (string) $request->userAgent()
            ));
        } catch (InvalidArgumentException $exception) {
            $message = $exception->getMessage();
            $status = str_contains($message, '公司邮箱') ? 403 : 410;
            return response()->json(['code' => $status, 'msg' => $message, 'data' => null], $status);
        }
    }

    /** Public heartbeat after the viewer has entered a company email. */
    public function heartbeatProjectReportShare(Request $request, string $shareId): JsonResponse
    {
        $data = $request->validate([
            'email' => 'required|email|max:191',
            'deviceInfo' => 'nullable|array',
        ]);

        try {
            return $this->ok($this->service->heartbeatProjectReportShare(
                $shareId,
                (string) $data['email'],
                is_array($data['deviceInfo'] ?? null) ? $data['deviceInfo'] : [],
                $request->ip(),
                (string) $request->userAgent()
            ));
        } catch (InvalidArgumentException $exception) {
            return response()->json(['code' => 403, 'msg' => $exception->getMessage(), 'data' => null], 403);
        }
    }

    /** Internal abnormal share access alert list. */
    public function projectReportShareAlerts(Request $request): JsonResponse
    {
        return $this->ok($this->service->projectReportShareAlerts($request->only([
            'projectCode', 'status', 'pageIndex', 'pageSize',
        ])));
    }

    /** Revoke a suspicious or leaked project report link. */
    public function revokeProjectReportShare(Request $request, string $shareId): JsonResponse
    {
        try {
            return $this->ok($this->service->revokeProjectReportShare(
                $shareId,
                (string) data_get($request->attributes->get('jkclEmployee'), 'email')
            ));
        } catch (InvalidArgumentException $exception) {
            return response()->json(['code' => 404, 'msg' => $exception->getMessage(), 'data' => null], 404);
        }
    }

    /** Public share metadata; does not require employee login and does not consume open count. */
    public function sharedReportMeta(string $shareId): JsonResponse
    {
        $data = $this->service->sharedAiReportMeta($shareId);
        if (!$data) {
            return response()->json(['code' => 404, 'msg' => '分享链接不存在或已删除', 'data' => null], 404);
        }

        return $this->ok($data);
    }

    /** Public password verification; consumes one successful open. */
    public function openSharedReport(Request $request, string $shareId): JsonResponse
    {
        $data = $request->validate([
            'password' => 'required|string|max:64',
        ]);

        try {
            return $this->ok($this->service->openSharedAiReport(
                $shareId,
                (string) $data['password'],
                $request->ip(),
                (string) $request->userAgent()
            ));
        } catch (InvalidArgumentException $exception) {
            $message = $exception->getMessage();
            $status = str_contains($message, '3 次') || str_contains($message, '不存在') ? 410 : 403;
            return response()->json(['code' => $status, 'msg' => $message, 'data' => null], $status);
        }
    }

    /** Create an auditable diagnosis task under the employee's project scope. */
    public function storeIssue(FunnelDiagnosisIssueStoreRequest $request): JsonResponse
    {
        if ($denied = $this->projectDenied($request, $request->validated('projectCode'))) {
            return $denied;
        }

        try {
            return $this->ok($this->service->storeIssue(
                $request->validated(),
                (string) data_get($request->attributes->get('jkclEmployee'), 'email')
            ));
        } catch (InvalidArgumentException $exception) {
            return $this->error([422, $exception->getMessage()]);
        }
    }

    /** Update only an issue whose project remains inside the employee's scope. */
    public function updateIssue(FunnelDiagnosisIssueUpdateRequest $request): JsonResponse
    {
        $projectCode = $this->service->issueProjectCode($request->validated('issueId'));
        if ($denied = $this->projectDenied($request, $projectCode)) {
            return $denied;
        }

        try {
            return $this->ok($this->service->updateIssue(
                $request->validated(),
                (string) data_get($request->attributes->get('jkclEmployee'), 'email')
            ));
        } catch (InvalidArgumentException $exception) {
            return $this->error([422, $exception->getMessage()]);
        }
    }

    /** Reject unauthorized project context before querying ADB/RDS. */
    private function projectDenied(Request $request, ?string $projectCode): ?JsonResponse
    {
        $allowed = $request->attributes->get('jkclAllowedProjectCodes', []);
        if (!in_array('*', $allowed, true) && !in_array($projectCode, $allowed, true)) {
            return response()->json(['ok' => false, 'error' => 'project_forbidden'], 403);
        }

        return null;
    }
}
