<?php

return [
    'project_app_mapping_sync' => [
        'enabled' => env('ADB_PROJECT_APP_MAPPING_SYNC_ENABLED', env('ADB_TRACKING_EVENT_LOAD_ENABLED', env('ADB_LOAD_ENABLED', false))),
    ],

    'tracking_events' => [
        // ADB_LOAD_ENABLED is retained as a deployment-compatible fallback.
        'enabled' => env('ADB_TRACKING_EVENT_LOAD_ENABLED', env('ADB_LOAD_ENABLED', false)),
        'batch_size' => (int) env('ADB_LOAD_BATCH_SIZE', 1000),
        'event_config_table' => env('ADB_TRACKING_EVENT_CONFIG_TABLE', 'dim_tracking_event_config'),
        'project_mapping_table' => env('ADB_PROJECT_APP_MAPPING_TABLE', 'dim_project_app_mapping'),
        'event_table' => 'dwd_app_tracking_event_v18',
        'quarantine_table' => 'dwd_app_tracking_event_quarantine_v18',
        'conflict_table' => 'dwd_app_tracking_event_conflict_v18',
        'default_timezone' => env('ADB_TRACKING_EVENT_TIMEZONE', 'Asia/Shanghai'),
    ],

    'tracking_event_summaries' => [
        'enabled' => env('ADB_TRACKING_EVENT_SUMMARY_ENABLED', env('ADB_TRACKING_EVENT_LOAD_ENABLED', env('ADB_LOAD_ENABLED', false))),
        'event_daily_table' => env('ADB_TRACKING_EVENT_DAILY_TABLE', 'ads_app_tracking_event_daily'),
        'field_daily_table' => env('ADB_TRACKING_FIELD_DAILY_TABLE', 'ads_app_tracking_field_daily'),
        'field_value_daily_table' => env('ADB_TRACKING_FIELD_VALUE_DAILY_TABLE', 'ads_app_tracking_field_value_daily'),
        'default_lookback_days' => (int) env('ADB_TRACKING_EVENT_SUMMARY_LOOKBACK_DAYS', 3),
        'field_value_min_count' => (int) env('ADB_TRACKING_FIELD_VALUE_MIN_COUNT', 1),
    ],

    'funnel_aggregates' => [
        'enabled' => env('ADB_FUNNEL_AGGREGATE_ENABLED', false),
        'default_lookback_days' => (int) env('ADB_FUNNEL_AGGREGATE_LOOKBACK_DAYS', 3),
        'metric_version' => env('ADB_FUNNEL_AGGREGATE_METRIC_VERSION', 'jkcl-v1.8-aggregate-v1'),
        'funnel_version_id' => env('ADB_FUNNEL_AGGREGATE_FUNNEL_VERSION_ID', 'builtin-jkcl-v1.8'),
        'timezone_offset_hours' => (int) env('ADB_FUNNEL_AGGREGATE_TIMEZONE_OFFSET_HOURS', 8),
        'lock_seconds' => (int) env('ADB_FUNNEL_AGGREGATE_LOCK_SECONDS', 1800),
        'insert_batch_size' => (int) env('ADB_FUNNEL_AGGREGATE_INSERT_BATCH_SIZE', 200),
        'write_connection' => env('ADB_FUNNEL_AGGREGATE_WRITE_CONNECTION', 'adb_write'),
        'tables' => [
            'subject_stage_daily' => 'dwm_funnel_subject_stage_daily_v18',
            'funnel_stage_hourly' => 'dws_app_funnel_stage_hourly_v18',
            'funnel_stage_daily' => 'dws_app_funnel_stage_daily_v18',
            'ad_fulfillment_daily' => 'dws_ad_fulfillment_daily_v18',
            'vpn_quality_daily' => 'dws_vpn_connection_quality_daily_v18',
            'event_quality_daily' => 'dws_app_event_quality_daily_v18',
            'screen_path_daily' => 'dws_screen_path_daily_v18',
        ],
    ],
];
