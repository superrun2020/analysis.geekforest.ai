<?php

namespace App\Http\Routes\V3;

use App\Http\Controllers\V3\JkclFunnelController;
use Illuminate\Contracts\Routing\Registrar;

class JkclFunnelRoute
{
    /** Map the OA-authenticated operational surface without exposing admin routes. */
    public function map(Registrar $router): void
    {
        $router->group([
            'prefix' => 'jkcl-funnel',
            'middleware' => ['log'],
        ], function ($router): void {
            $router->get('/shared-reports/{shareId}/meta', [JkclFunnelController::class, 'sharedReportMeta']);
            $router->post('/shared-reports/{shareId}/open', [JkclFunnelController::class, 'openSharedReport']);
            $router->get('/project-report-shares/{shareId}/meta', [JkclFunnelController::class, 'projectReportShareMeta']);
            $router->post('/project-report-shares/{shareId}/open', [JkclFunnelController::class, 'openProjectReportShare']);
            $router->post('/project-report-shares/{shareId}/heartbeat', [JkclFunnelController::class, 'heartbeatProjectReportShare']);
            $router->get('/codex/ads-tracking', [JkclFunnelController::class, 'codexAdsTracking']);
            $router->get('/codex/vpn-tracking', [JkclFunnelController::class, 'codexVpnTracking']);
        });

        $router->group([
            'prefix' => 'jkcl-funnel',
            'middleware' => ['jkcl-funnel-employee', 'log'],
        ], function ($router): void {
            $router->get('/session', [JkclFunnelController::class, 'session']);
            $router->get('/options', [JkclFunnelController::class, 'options']);
            $router->get('/projects', [JkclFunnelController::class, 'projects']);
            $router->get('/date-session-summary', [JkclFunnelController::class, 'dateSessionSummary']);
            $router->post('/query', [JkclFunnelController::class, 'query']);
            $router->post('/ai-analysis', [JkclFunnelController::class, 'aiAnalysis']);
            $router->post('/tracking-event-coverage', [JkclFunnelController::class, 'trackingEventCoverage']);
            $router->post('/codex-links', [JkclFunnelController::class, 'createCodexQueryLinks']);
            $router->post('/project-report-shares', [JkclFunnelController::class, 'createProjectReportShare']);
            $router->get('/project-report-shares/alerts', [JkclFunnelController::class, 'projectReportShareAlerts']);
            $router->post('/project-report-shares/{shareId}/revoke', [JkclFunnelController::class, 'revokeProjectReportShare']);
            $router->post('/issues/create', [JkclFunnelController::class, 'storeIssue']);
            $router->post('/issues/update', [JkclFunnelController::class, 'updateIssue']);
        });
    }
}
