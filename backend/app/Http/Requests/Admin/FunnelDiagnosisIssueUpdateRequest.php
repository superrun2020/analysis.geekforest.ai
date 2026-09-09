<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class FunnelDiagnosisIssueUpdateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'issueId' => 'required|string|max:64',
            'status' => ['required', Rule::in(['OPEN', 'INVESTIGATING', 'FIXED', 'VERIFIED', 'CLOSED'])],
            'rootCause' => 'nullable|string|max:5000',
            'fixPlan' => 'nullable|string|max:5000',
            'ownerId' => 'nullable|string|max:128',
            'targetVersion' => 'nullable|string|max:64',
            'metricCode' => ['nullable', Rule::in(['dau', 'ad_viewer_rate', 'opportunity_coverage', 'impressions_per_viewer', 'revenue', 'fulfillment_rate'])],
            'baselineStartDate' => 'nullable|required_with:baselineEndDate|date_format:Y-m-d',
            'baselineEndDate' => 'nullable|required_with:baselineStartDate|date_format:Y-m-d|after_or_equal:baselineStartDate',
            'verifyStartDate' => 'nullable|required_with:verifyEndDate|date_format:Y-m-d',
            'verifyEndDate' => 'nullable|required_with:verifyStartDate|date_format:Y-m-d|after_or_equal:verifyStartDate',
        ];
    }
}
