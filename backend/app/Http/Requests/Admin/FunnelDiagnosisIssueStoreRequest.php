<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class FunnelDiagnosisIssueStoreRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'projectCode' => 'required|string|max:64',
            'appIdentifier' => 'required|string|max:191',
            'funnelVersionId' => 'nullable|string|max:64',
            'issueType' => ['required', Rule::in(['conversion_drop', 'data_quality', 'chain_break', 'other'])],
            'severity' => ['required', Rule::in(['P0', 'P1', 'P2', 'P3'])],
            'title' => 'required|string|max:191',
            'description' => 'required|string|max:5000',
            'ownerId' => 'nullable|string|max:128',
            'targetVersion' => 'nullable|string|max:64',
            'metricCode' => ['nullable', Rule::in(['dau', 'ad_viewer_rate', 'opportunity_coverage', 'impressions_per_viewer', 'revenue', 'fulfillment_rate'])],
            'baselineStartDate' => 'nullable|required_with:baselineEndDate|date_format:Y-m-d',
            'baselineEndDate' => 'nullable|required_with:baselineStartDate|date_format:Y-m-d|after_or_equal:baselineStartDate',
            'evidenceEventId' => 'nullable|required_with:evidenceDate|string|max:64',
            'evidenceDate' => 'nullable|required_with:evidenceEventId|date_format:Y-m-d',
            'slaDueAt' => 'nullable|date',
        ];
    }
}
