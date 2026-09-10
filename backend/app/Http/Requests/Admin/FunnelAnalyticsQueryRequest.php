<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

class FunnelAnalyticsQueryRequest extends FormRequest
{
    private const ADS_USER_STEPS = ['dau', 'eligibility', 'eligible', 'opportunity', 'request', 'show_attempt', 'impression', 'paid'];

    private const ADS_EVENT_STEPS = ['opportunity', 'cache_hit', 'realtime_request', 'load_success', 'ad_ready', 'show_attempt', 'impression', 'paid'];

    private const VPN_STEPS = ['dau', 'connect_attempt', 'connect_success', 'post_connect_opportunity', 'post_connect_impression'];

    public function authorize(): bool
    {
        return true;
    }

    /**
     * Default analysis to today while keeping the ADB partition range bounded.
     */
    protected function prepareForValidation(): void
    {
        $this->merge([
            'dateFrom' => $this->input('dateFrom', Carbon::today()->toDateString()),
            'dateTo' => $this->input('dateTo', Carbon::today()->toDateString()),
            'page' => $this->input('page', 'overview'),
        ]);
    }

    public function rules(): array
    {
        return [
            'page' => ['required', Rule::in(['overview', 'workbench', 'diagnosis', 'cohort', 'path', 'evidence', 'issues', 'snapshot', 'network_failure_matrix', 'version_comparison', 'domain_report'])],
            'dateFrom' => 'required|date_format:Y-m-d',
            'dateTo' => 'required|date_format:Y-m-d|after_or_equal:dateFrom',
            'projectCode' => 'nullable|string|max:64',
            'appIdentifier' => 'nullable|string|max:191',
            'issueId' => 'nullable|string|max:64',
            'platform' => ['nullable', Rule::in(['android', 'ios'])],
            'country' => 'nullable|string|max:16',
            'appVersion' => 'nullable|string|max:64',
            'buildNumber' => 'nullable|integer|min:0',
            'timezone' => 'nullable|timezone|max:64',
            'compareType' => ['nullable', Rule::in(['none', 'yesterday_same_period', 'previous_period'])],
            'domain' => ['nullable', Rule::in(['vpn', 'ads', 'quality'])],
            'unit' => ['nullable', Rule::in(['users', 'sessions', 'events'])],
            'dimension' => ['nullable', Rule::in(['stat_date', 'app_version', 'country_code', 'platform', 'network_type', 'device_model', 'ad_format', 'placement'])],
            'dimensions' => 'nullable|array|min:1|max:5',
            'dimensions.*' => ['string', Rule::in(['stat_date', 'app_version', 'country_code', 'platform', 'asn', 'server_id', 'protocol'])],
            'startStep' => 'nullable|string|max:100',
            'endStep' => 'nullable|string|max:100',
            'screenName' => 'nullable|string|max:100',
            'networkType' => 'nullable|string|max:32',
            'placement' => 'nullable|string|max:100',
            'adFormat' => 'nullable|string|max:32',
            'adSource' => 'nullable|string|max:191',
            'qualityStatus' => ['nullable', Rule::in(['valid', 'warning'])],
            'eventModule' => 'nullable|string|max:64',
            'eventName' => 'nullable|string|max:100',
            'sourceType' => ['nullable', Rule::in(['api', 'firebase', 'both'])],
            'evidenceMode' => ['nullable', Rule::in(['user', 'ad'])],
            'anchorEventId' => 'nullable|string|max:64',
            'onlyAbnormal' => 'nullable|boolean',
            'keyword' => 'nullable|string|max:191',
            'pageIndex' => 'nullable|integer|min:1',
            'pageSize' => 'nullable|integer|min:1|max:100',
        ];
    }

    /**
     * Reject unbounded raw-event scans before they reach AnalyticDB.
     */
    public function withValidator($validator): void
    {
        $validator->after(function ($validator): void {
            if (!$this->filled('dateFrom') || !$this->filled('dateTo')) {
                return;
            }

            if (Carbon::parse($this->input('dateFrom'))->diffInDays(Carbon::parse($this->input('dateTo'))) > 31) {
                $validator->errors()->add('dateTo', '单次查询时间范围不能超过 32 天');
            }

            if ($this->input('page') !== 'diagnosis') {
                return;
            }

            $steps = $this->diagnosisSteps();
            $startStep = $this->input('startStep');
            $endStep = $this->input('endStep');
            if ($startStep !== null && !in_array($startStep, $steps, true)) {
                $validator->errors()->add('startStep', '起点指标不属于当前诊断领域和统计口径');
            }
            if ($endStep !== null && !in_array($endStep, $steps, true)) {
                $validator->errors()->add('endStep', '终点指标不属于当前诊断领域和统计口径');
            }
            if ($startStep !== null && $endStep !== null
                && in_array($startStep, $steps, true)
                && in_array($endStep, $steps, true)
                && array_search($endStep, $steps, true) <= array_search($startStep, $steps, true)
            ) {
                $validator->errors()->add('endStep', '终点指标必须位于起点指标之后');
            }
        });
    }

    /** Return the only valid ordered step list for the requested diagnosis scope. */
    private function diagnosisSteps(): array
    {
        if ($this->input('domain', 'ads') === 'vpn') {
            return self::VPN_STEPS;
        }

        return $this->input('unit', 'users') === 'events'
            ? self::ADS_EVENT_STEPS
            : self::ADS_USER_STEPS;
    }
}
