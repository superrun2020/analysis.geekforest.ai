<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;

class FunnelDateSessionSummaryRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $timezone = config('app.timezone', 'Asia/Shanghai');
        $dateTo = $this->input('dateTo') ?: Carbon::now($timezone)->toDateString();
        $dateFrom = $this->input('dateFrom') ?: Carbon::parse($dateTo, $timezone)->subDays(29)->toDateString();

        $this->merge([
            'dateFrom' => $dateFrom,
            'dateTo' => $dateTo,
            'domain' => $this->input('domain', 'ads'),
        ]);
    }

    public function rules(): array
    {
        return [
            'dateFrom' => 'required|date_format:Y-m-d',
            'dateTo' => 'required|date_format:Y-m-d|after_or_equal:dateFrom',
            'projectCode' => 'nullable|string|max:64',
            'appIdentifier' => 'nullable|string|max:191',
            'platform' => ['nullable', Rule::in(['android', 'ios'])],
            'country' => 'nullable|string|max:16',
            'appVersion' => 'nullable|string|max:64',
            'domain' => ['nullable', Rule::in(['ads', 'vpn', 'quality'])],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator): void {
            if (!$this->filled('dateFrom') || !$this->filled('dateTo')) {
                return;
            }

            if (Carbon::parse($this->input('dateFrom'))->diffInDays(Carbon::parse($this->input('dateTo'))) > 90) {
                $validator->errors()->add('dateTo', '日期数据量汇总最多查询 91 天');
            }
        });
    }
}
