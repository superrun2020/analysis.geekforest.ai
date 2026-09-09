// Generated from the verified Feishu TSV snapshot.
export const launcherV18Source = {
  "version": "V1.8-Launcher.2",
  "eventCount": 71,
  "fieldCount": 318,
  "sourceUrl": "https://geekforest.feishu.cn/wiki/HQiGwOyNUibgw9kKaQ4c06bZnHc"
} as const;

export const launcherV18Events = [
  {
    "id": "launcher:app_first_open",
    "name": "app_first_open",
    "displayName": "首次打开",
    "stage": "App生命周期",
    "priority": "P2",
    "trackingLocation": "Application启动初始化层；本地持久化first_open_sent=false时触发。",
    "triggerTiming": "每次安装仅一次；Firebase首期由本地first_open_sent标记保证一次性触发并直接logEvent；中台直传必达阶段才先写入本地outbox，服务端ACK后出队。",
    "metricPurpose": "首开用户、安装→首开率、新增用户、渠道首开率",
    "parameters": [
      {
        "name": "install_time",
        "displayName": "安装时间",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "首次安装时间；没有可靠安装时间时取首次启动时间"
      },
      {
        "name": "is_reinstall",
        "displayName": "是否重装",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "1=可能重装；0=首次安装；仅作辅助判断"
      },
      {
        "name": "install_source",
        "displayName": "安装来源",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "Google Play、第三方商店、预装、未知"
      }
    ]
  },
  {
    "id": "launcher:app_foreground",
    "name": "app_foreground",
    "displayName": "进入前台",
    "stage": "App生命周期",
    "priority": "P1",
    "trackingLocation": "App lifecycle observer检测整个App进入前台；Android/iOS按各自生命周期API实现。",
    "triggerTiming": "每次App从后台进入前台时上报一次；首次启动进入前台也上报。",
    "metricPurpose": "中台DAU、会话数、回访率、Firebase DAU对账",
    "parameters": [
      {
        "name": "foreground_reason",
        "displayName": "进入前台原因",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "first_open/resume/notification/deep_link/unknown"
      },
      {
        "name": "previous_background_ms",
        "displayName": "上次后台时长",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "毫秒；首次会话为0"
      },
      {
        "name": "session_index",
        "displayName": "安装后会话序号",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "从1开始递增"
      },
      {
        "name": "launch_type",
        "displayName": "启动类型",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "cold_start/resume"
      }
    ]
  },
  {
    "id": "launcher:app_once_params",
    "name": "app_once_params",
    "displayName": "一次性参数",
    "stage": "App生命周期",
    "priority": "P1",
    "trackingLocation": "统一Analytics/SDK初始化完成后；远程配置应用状态以当前快照为准。",
    "triggerTiming": "埋点SDK初始化完成后每进程上报一次；进程内不得重复。",
    "metricPurpose": "运行环境分群、问题定位、远程配置生效判断",
    "parameters": [
      {
        "name": "consent_status",
        "displayName": "隐私授权状态",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "SDK初始化后一次性快照；授权变化另由 consent_result 事件记录。"
      },
      {
        "name": "personalized_allowed",
        "displayName": "是否允许个性化广告",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "SDK初始化后一次性快照；可得时传。"
      },
      {
        "name": "country_code",
        "displayName": "启动国家/地区码",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "启动时识别国家/地区；优先 IP 定位或业务 Provider。"
      },
      {
        "name": "city",
        "displayName": "启动城市",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "启动时 IP 定位城市；可得时传。"
      },
      {
        "name": "device_model",
        "displayName": "设备型号",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "设备型号；Firebase自动可得时客户端不重复作为普通公共参数。"
      },
      {
        "name": "os_name",
        "displayName": "操作系统",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "如 iOS/Android。"
      },
      {
        "name": "os_version",
        "displayName": "系统版本",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "系统版本；Firebase自动可得时客户端不重复作为普通公共参数。"
      },
      {
        "name": "app_version",
        "displayName": "App版本",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "App版本；Firebase自动可得时客户端不重复作为普通公共参数。"
      },
      {
        "name": "app_build",
        "displayName": "构建号",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "App build/versionCode；SDK初始化后一次性传。"
      },
      {
        "name": "locale_language",
        "displayName": "本地语言",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "系统语言；需要原始客户端值时在一次性参数中传。"
      },
      {
        "name": "locale_country",
        "displayName": "本地国家",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "系统地区；启动环境快照。"
      },
      {
        "name": "timezone",
        "displayName": "客户端时区",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "IANA时区或UTC offset；启动环境快照。"
      },
      {
        "name": "open_times",
        "displayName": "安装后打开次数",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "从1开始；本次启动维度。"
      },
      {
        "name": "is_subscriber",
        "displayName": "是否订阅用户",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "SDK初始化时订阅状态快照；不确定时不伪造。"
      },
      {
        "name": "remote_config_applied",
        "displayName": "远程配置是否已应用",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "true 表示本次已经拿到并应用 Firebase Remote Config；false 表示仍用默认/兜底配置。"
      }
    ]
  },
  {
    "id": "launcher:app_start_complete",
    "name": "app_start_complete",
    "displayName": "App启动完成",
    "stage": "App生命周期",
    "priority": "P0",
    "trackingLocation": "Application/Scene初始化协调器；必要SDK初始化完成且首屏可交互处。",
    "triggerTiming": "每次冷启动或暖启动完成一次；失败也要形成终态。",
    "metricPurpose": "启动完成率、冷启动P50/P95、启动失败模块分布、启动→首屏转化",
    "parameters": [
      {
        "name": "start_type",
        "displayName": "启动类型",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "cold/warm/hot/unknown"
      },
      {
        "name": "startup_duration_ms",
        "displayName": "启动耗时",
        "dataType": "Int64",
        "reportingMode": "P0｜是",
        "description": "进程/场景启动至首屏可交互的整数毫秒"
      },
      {
        "name": "first_screen",
        "displayName": "首个页面",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "稳定页面英文枚举"
      },
      {
        "name": "init_result",
        "displayName": "初始化结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "success/partial/failed/timeout"
      },
      {
        "name": "failed_module",
        "displayName": "失败模块",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "config/analytics/vpn/ads/other/unknown"
      }
    ]
  },
  {
    "id": "launcher:session_heartbeat",
    "name": "session_heartbeat",
    "displayName": "前台心跳",
    "stage": "App生命周期",
    "priority": "P2",
    "trackingLocation": "Application前台定时任务；仅前台运行。",
    "triggerTiming": "App处于前台时每3～5分钟上报一次；进入后台立即停止。",
    "metricPurpose": "有效活跃时长、心跳覆盖率、上报中断用户",
    "parameters": [
      {
        "name": "foreground_duration_ms",
        "displayName": "累计前台时长",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "当前会话累计前台毫秒"
      },
      {
        "name": "queue_size",
        "displayName": "本地事件队列长度",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "仅中台直传/必达链路适用；Firebase首期无outbox时省略"
      }
    ]
  },
  {
    "id": "launcher:app_background",
    "name": "app_background",
    "displayName": "进入后台",
    "stage": "App生命周期",
    "priority": "P1",
    "trackingLocation": "App lifecycle observer检测整个App进入后台；Android可映射ProcessLifecycleOwner，iOS映射UIApplication/Scene lifecycle。不得用单页面离开替代App后台。",
    "triggerTiming": "按Home、切换App、锁屏等导致整个App进入后台。",
    "metricPurpose": "会话时长、短会话率、后台导致广告未展示比例",
    "parameters": [
      {
        "name": "current_screen",
        "displayName": "当前页面",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "进入后台前最后可见页面"
      },
      {
        "name": "session_duration_ms",
        "displayName": "会话时长",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "本次前台会话持续毫秒数"
      },
      {
        "name": "background_reason",
        "displayName": "后台原因",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "home_or_switch_app/screen_off/system_interruption/unknown"
      },
      {
        "name": "pending_ad_count",
        "displayName": "待消费广告数",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "已加载但未产生终态的广告对象数量"
      }
    ]
  },
  {
    "id": "launcher:screen_view",
    "name": "screen_view",
    "displayName": "页面展示",
    "stage": "页面行为",
    "priority": "P0",
    "trackingLocation": "Navigation destination监听器；Compose页面LaunchedEffect；Fragment首次可见。",
    "triggerTiming": "每次页面真正可见时一次；同一次页面访问内保持不变。",
    "metricPurpose": "页面UV/PV、页面到达率、广告场景覆盖率",
    "parameters": [
      {
        "name": "screen_name",
        "displayName": "页面名称",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "稳定页面英文枚举；禁止动态文案"
      },
      {
        "name": "previous_screen",
        "displayName": "来源页面",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "稳定页面英文枚举；首次进入或无法判断时省略"
      },
      {
        "name": "screen_view_id",
        "displayName": "页面访问ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "每次页面访问唯一UUID；关联页面就绪/异常/退出事件"
      }
    ]
  },
  {
    "id": "launcher:element_click",
    "name": "element_click",
    "displayName": "元素点击",
    "stage": "页面行为",
    "priority": "P1",
    "trackingLocation": "统一UI点击代理层、Compose Modifier.clickable、View.OnClickListener或导航组件点击封装。",
    "triggerTiming": "用户真实完成一次点击/滑动动作时。",
    "metricPurpose": "元素点击PV/UV、页面点击率、关键路径转化",
    "parameters": [
      {
        "name": "element_name",
        "displayName": "元素名称",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "稳定英文枚举，不上传动态文案"
      },
      {
        "name": "action_name",
        "displayName": "动作名称",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "continue/delete/merge/back/swipe_up等标准动作"
      },
      {
        "name": "content_type",
        "displayName": "业务内容类型",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "photo/video/contacts/calendar/private等"
      },
      {
        "name": "scene",
        "displayName": "业务场景",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "订阅或功能触发场景"
      },
      {
        "name": "tab_name",
        "displayName": "Tab名称",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "稳定英文Tab枚举"
      }
    ]
  },
  {
    "id": "launcher:screen_exit",
    "name": "screen_exit",
    "displayName": "离开页面",
    "stage": "页面行为",
    "priority": "P0",
    "trackingLocation": "统一Navigation监听器；Fragment.onDestroyView；Compose DisposableEffect.onDispose。",
    "triggerTiming": "每次有效页面访问结束一次。",
    "metricPurpose": "页面停留、user_left_page广告损耗、退出路径",
    "parameters": [
      {
        "name": "screen_name",
        "displayName": "离开页面",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "原页面名称"
      },
      {
        "name": "next_screen",
        "displayName": "目标页面",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "App内目标页面；进入后台可为空"
      },
      {
        "name": "exit_action",
        "displayName": "退出动作",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "back/tab_switch/navigate/close/flow_cancelled"
      },
      {
        "name": "screen_duration_ms",
        "displayName": "页面停留时长",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "页面可见到退出的毫秒数"
      },
      {
        "name": "app_state",
        "displayName": "App状态",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "foreground/background；用于区分用户离页和App后台"
      },
      {
        "name": "screen_view_id",
        "displayName": "页面访问ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联本次screen_view"
      }
    ]
  },
  {
    "id": "launcher:business_task_completed",
    "name": "business_task_completed",
    "displayName": "业务任务完成",
    "stage": "核心行为",
    "priority": "P1",
    "trackingLocation": "业务UseCase/Repository返回最终结果后。",
    "triggerTiming": "任务成功、失败或取消形成终态时。",
    "metricPurpose": "任务完成率、耗时、业务功能使用UV",
    "parameters": [
      {
        "name": "task_type",
        "displayName": "任务类型",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "clean_scan等稳定业务枚举"
      },
      {
        "name": "result_status",
        "displayName": "任务状态",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "completed/failed/cancelled"
      },
      {
        "name": "duration_ms",
        "displayName": "任务耗时",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "整数毫秒"
      },
      {
        "name": "item_count",
        "displayName": "处理对象数",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "扫描或处理的对象数量"
      }
    ]
  },
  {
    "id": "launcher:core_action",
    "name": "core_action",
    "displayName": "核心功能行为",
    "stage": "核心行为",
    "priority": "P0",
    "trackingLocation": "业务UseCase/Repository成功或失败结果回调，不在按钮点击即认定成功。",
    "triggerTiming": "每个核心动作完成或失败时。",
    "metricPurpose": "核心行为转化、广告机会触达、用户质量",
    "parameters": [
      {
        "name": "action_name",
        "displayName": "动作名称",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "vpn_connect/vpn_disconnect/node_select等"
      },
      {
        "name": "action_result",
        "displayName": "动作结果",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "success/failed/cancelled/blocked"
      },
      {
        "name": "duration_ms",
        "displayName": "动作耗时",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "动作开始到终态毫秒数"
      },
      {
        "name": "error_code",
        "displayName": "业务错误码",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "稳定机器码，成功为空"
      }
    ]
  },
  {
    "id": "launcher:launcher_onboarding_action",
    "name": "launcher_onboarding_action",
    "displayName": "引导操作",
    "stage": "Launcher-引导",
    "priority": "P0",
    "trackingLocation": "按钮点击确认后",
    "triggerTiming": "每次有效操作",
    "metricPurpose": "引导完成率、跳过率",
    "parameters": [
      {
        "name": "action_type",
        "displayName": "操作类型",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "P0；next/back/skip/close/allow/open_settings/complete"
      },
      {
        "name": "launcher_session_id",
        "displayName": "桌面会话ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；本次会话复用"
      },
      {
        "name": "onboarding_step",
        "displayName": "引导步骤",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；同曝光枚举"
      }
    ]
  },
  {
    "id": "launcher:launcher_onboarding_view",
    "name": "launcher_onboarding_view",
    "displayName": "引导步骤曝光",
    "stage": "Launcher-引导",
    "priority": "P1",
    "trackingLocation": "对应引导页可见后",
    "triggerTiming": "每个步骤每次可见",
    "metricPurpose": "引导步骤到达率",
    "parameters": [
      {
        "name": "launcher_session_id",
        "displayName": "桌面会话ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；本次前台会话生成"
      },
      {
        "name": "onboarding_step",
        "displayName": "引导步骤",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；welcome/benefit/default_launcher/theme/gesture/complete"
      },
      {
        "name": "step_index",
        "displayName": "步骤序号",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "P1；从1开始"
      }
    ]
  },
  {
    "id": "launcher:launcher_aux_permission_result",
    "name": "launcher_aux_permission_result",
    "displayName": "Launcher辅助权限结果",
    "stage": "Launcher-授权",
    "priority": "P0",
    "trackingLocation": "对应系统权限回调或返回状态复核层",
    "triggerTiming": "每次真实请求或复核得到结果时上报；未请求不报",
    "metricPurpose": "辅助权限授予率、拒绝率、功能阻塞率",
    "parameters": [
      {
        "name": "failure_reason",
        "displayName": "失败原因",
        "dataType": "String",
        "reportingMode": "条件P0｜条件必填",
        "description": "permission_denied/system_blocked/oem_restriction/api_error/unknown"
      },
      {
        "name": "permission_type",
        "displayName": "权限类型",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "notification/exact_alarm/widget_bind/overlay"
      },
      {
        "name": "result",
        "displayName": "权限结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "granted/denied/cancelled/not_required/failed"
      },
      {
        "name": "trigger_source",
        "displayName": "触发来源",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "onboarding/reminder/widget/settings/feature_gate"
      }
    ]
  },
  {
    "id": "launcher:launcher_default_permission_lost",
    "name": "launcher_default_permission_lost",
    "displayName": "默认桌面权限丢失",
    "stage": "Launcher-授权",
    "priority": "P0",
    "trackingLocation": "foreground/home_visible检查发现上次default、本次not_default时",
    "triggerTiming": "状态从default变为not_default或unknown时仅上报一次，恢复后可再次触发",
    "metricPurpose": "默认桌面保持率、权限丢失率、OEM/版本异常率",
    "parameters": [
      {
        "name": "current_status",
        "displayName": "当前默认状态",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "not_default/unknown"
      },
      {
        "name": "detected_source",
        "displayName": "发现来源",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "foreground/home_visible/cold_start/system_return"
      },
      {
        "name": "loss_reason",
        "displayName": "权限丢失原因",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "user_changed_default/app_disabled/system_reset/restore/unknown"
      },
      {
        "name": "previous_status",
        "displayName": "上次默认状态",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "固定default"
      }
    ]
  },
  {
    "id": "launcher:launcher_default_prompt_action",
    "name": "launcher_default_prompt_action",
    "displayName": "默认桌面提示操作",
    "stage": "Launcher-授权",
    "priority": "P0",
    "trackingLocation": "授权弹窗/引导页按钮点击处理函数",
    "triggerTiming": "按钮动作确认后立即上报；每次可交互曝光只记录第一次终止动作",
    "metricPurpose": "去设置点击率、稍后率、关闭率、入口转化率",
    "parameters": [
      {
        "name": "action",
        "displayName": "提示操作",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "set_now/later/close/back"
      },
      {
        "name": "attempt_index",
        "displayName": "授权尝试序号",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "从1开始"
      },
      {
        "name": "auth_flow_id",
        "displayName": "授权流程ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "沿用当前授权流程"
      },
      {
        "name": "prompt_source",
        "displayName": "提示来源",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "与prompt_show一致"
      }
    ]
  },
  {
    "id": "launcher:launcher_default_prompt_show",
    "name": "launcher_default_prompt_show",
    "displayName": "默认桌面授权提示曝光",
    "stage": "Launcher-授权",
    "priority": "P0",
    "trackingLocation": "默认桌面授权弹窗/引导页完成可见回调，不在创建View时提前上报",
    "triggerTiming": "提示实际可见且可交互时上报一次",
    "metricPurpose": "提示触达率、各入口授权转化率、Prompt UV",
    "parameters": [
      {
        "name": "attempt_index",
        "displayName": "授权尝试序号",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "从1开始"
      },
      {
        "name": "auth_flow_id",
        "displayName": "授权流程ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "沿用permission_check生成值"
      },
      {
        "name": "default_status_before",
        "displayName": "提示前状态",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "固定not_default；异常进入隔离"
      },
      {
        "name": "prompt_source",
        "displayName": "提示来源",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "splash/onboarding/save_prompt/settings_entry/permission_lost_recovery"
      },
      {
        "name": "prompt_variant",
        "displayName": "提示版本",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "稳定实验ID或UI版本；禁止自由文本"
      }
    ]
  },
  {
    "id": "launcher:launcher_default_setting_result",
    "name": "launcher_default_setting_result",
    "displayName": "默认桌面授权结果",
    "stage": "Launcher-授权",
    "priority": "P0",
    "trackingLocation": "系统页返回后的统一DefaultLauncherStatusProvider复核层",
    "triggerTiming": "每个auth_flow_id完成复核后只上报一个终态",
    "metricPurpose": "授权成功率、拒绝率、取消率、技术失败率",
    "parameters": [
      {
        "name": "attempt_index",
        "displayName": "授权尝试序号",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "从1开始"
      },
      {
        "name": "auth_flow_id",
        "displayName": "授权流程ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "沿用当前授权流程；每轮仅一个终态"
      },
      {
        "name": "default_status_after",
        "displayName": "授权后状态",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "default/not_default/unknown"
      },
      {
        "name": "default_status_before",
        "displayName": "授权前状态",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "not_default/unknown"
      },
      {
        "name": "failure_reason",
        "displayName": "失败原因",
        "dataType": "String",
        "reportingMode": "条件P0｜条件必填",
        "description": "user_cancelled/role_not_granted/oem_restriction/state_check_timeout/system_error/unknown"
      },
      {
        "name": "result",
        "displayName": "授权结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "granted/denied/cancelled/failed/unknown"
      }
    ]
  },
  {
    "id": "launcher:launcher_permission_check",
    "name": "launcher_permission_check",
    "displayName": "默认桌面状态检查",
    "stage": "Launcher-授权",
    "priority": "P0",
    "trackingLocation": "Splash/应用回前台/系统设置返回/桌面真正可见前的统一 DefaultLauncherStatusProvider",
    "triggerTiming": "每次进入授权场景先检查；Splash预加载或广告补缓存不得触发",
    "metricPurpose": "无权限用户UV、状态检查成功率、授权漏斗入口UV",
    "parameters": [
      {
        "name": "attempt_index",
        "displayName": "本用户授权尝试序号",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "从1开始；仅not_default时传"
      },
      {
        "name": "auth_flow_id",
        "displayName": "授权流程ID",
        "dataType": "String",
        "reportingMode": "条件P0｜条件必填",
        "description": "default_status=not_default 时生成UUID；同一轮授权沿用"
      },
      {
        "name": "check_result",
        "displayName": "检查执行结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "success/failed"
      },
      {
        "name": "check_source",
        "displayName": "检查来源",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "splash/foreground/system_return/home_visible/save_action"
      },
      {
        "name": "default_status",
        "displayName": "默认桌面状态",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "default/not_default/unknown"
      },
      {
        "name": "failure_reason",
        "displayName": "检查失败原因",
        "dataType": "String",
        "reportingMode": "条件P0｜条件必填",
        "description": "role_manager_unavailable/state_check_error/oem_unsupported/timeout/unknown"
      }
    ]
  },
  {
    "id": "launcher:launcher_permission_effective",
    "name": "launcher_permission_effective",
    "displayName": "默认桌面授权生效",
    "stage": "Launcher-授权",
    "priority": "P0",
    "trackingLocation": "DesktopLauncherActivity桌面首帧/核心布局ready后的统一可见回调",
    "triggerTiming": "default_status=default且桌面首次真正可见时；每个auth_flow_id仅一次",
    "metricPurpose": "授权生效率、授权成功到桌面生效流失率、端到端授权转化率",
    "parameters": [
      {
        "name": "auth_flow_id",
        "displayName": "授权流程ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "沿用授权成功流程；冷启动已授权可省略"
      },
      {
        "name": "default_status",
        "displayName": "默认桌面状态",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "固定default"
      },
      {
        "name": "effective_source",
        "displayName": "生效来源",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "system_return/cold_start/foreground_recheck/save_prompt"
      },
      {
        "name": "home_visible",
        "displayName": "桌面是否真正可见",
        "dataType": "Int64",
        "reportingMode": "P0｜是",
        "description": "固定1"
      },
      {
        "name": "layout_ready",
        "displayName": "核心布局是否就绪",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "0/1"
      }
    ]
  },
  {
    "id": "launcher:launcher_system_setting_open",
    "name": "launcher_system_setting_open",
    "displayName": "系统默认桌面设置页拉起",
    "stage": "Launcher-授权",
    "priority": "P0",
    "trackingLocation": "RoleManager/Intent启动系统默认桌面设置的统一封装层",
    "triggerTiming": "调用系统API后得到成功、异常或无处理Activity结果时上报",
    "metricPurpose": "系统页拉起率、OEM失败率、入口类型成功率",
    "parameters": [
      {
        "name": "attempt_index",
        "displayName": "授权尝试序号",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "从1开始"
      },
      {
        "name": "auth_flow_id",
        "displayName": "授权流程ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "沿用当前授权流程"
      },
      {
        "name": "failure_reason",
        "displayName": "拉起失败原因",
        "dataType": "String",
        "reportingMode": "条件P0｜条件必填",
        "description": "activity_not_found/security_exception/oem_blocked/system_error/unknown"
      },
      {
        "name": "open_result",
        "displayName": "拉起结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "success/failed/blocked"
      },
      {
        "name": "setting_entry_type",
        "displayName": "系统入口类型",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "role_manager/home_settings/oem_settings/unknown"
      }
    ]
  },
  {
    "id": "launcher:launcher_system_setting_return",
    "name": "launcher_system_setting_return",
    "displayName": "从系统授权页返回",
    "stage": "Launcher-授权",
    "priority": "P0",
    "trackingLocation": "存在pending auth_flow_id时的onResume/newIntent/process restore入口",
    "triggerTiming": "App恢复可交互且完成默认桌面状态复核后上报",
    "metricPurpose": "系统页返回率、进程重建率、返回后状态分布",
    "parameters": [
      {
        "name": "auth_flow_id",
        "displayName": "授权流程ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "必须从本地pending context恢复，禁止新建"
      },
      {
        "name": "default_status_after",
        "displayName": "返回后默认状态",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "default/not_default/unknown"
      },
      {
        "name": "process_recreated",
        "displayName": "是否发生进程重建",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "0/1"
      },
      {
        "name": "return_source",
        "displayName": "返回来源",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "on_resume/new_intent/process_restore"
      }
    ]
  },
  {
    "id": "launcher:launcher_home_view",
    "name": "launcher_home_view",
    "displayName": "桌面首页曝光",
    "stage": "Launcher-首页",
    "priority": "P0",
    "trackingLocation": "DesktopLauncherActivity核心布局真正可见回调",
    "triggerTiming": "每次桌面从不可见变为可见时上报；同一可见周期只一次",
    "metricPurpose": "桌面DAU、授权后使用率、首页留存",
    "parameters": [
      {
        "name": "default_status",
        "displayName": "默认桌面状态",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "default/not_default/unknown"
      },
      {
        "name": "entry_source",
        "displayName": "桌面进入来源",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "cold_start/system_home/permission_return/foreground/unknown"
      },
      {
        "name": "is_default_launcher",
        "displayName": "是否默认桌面",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "P0；0/1"
      },
      {
        "name": "launcher_session_id",
        "displayName": "桌面会话ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；每次前台会话复用"
      },
      {
        "name": "layout_ready",
        "displayName": "核心布局是否就绪",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "0/1"
      }
    ]
  },
  {
    "id": "launcher:launcher_icon_pack_apply_result",
    "name": "launcher_icon_pack_apply_result",
    "displayName": "图标包应用结果",
    "stage": "Launcher-个性化",
    "priority": "P0",
    "trackingLocation": "图标包应用终态回调",
    "triggerTiming": "每次应用唯一终态",
    "metricPurpose": "图标包应用成功率",
    "parameters": [
      {
        "name": "changed_icon_count",
        "displayName": "变更图标数",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "P1；非负整数"
      },
      {
        "name": "failure_reason",
        "displayName": "失败原因",
        "dataType": "String",
        "reportingMode": "条件P0｜条件必填",
        "description": "条件P0；incompatible/download_failed/system_restricted/unknown"
      },
      {
        "name": "icon_pack_id",
        "displayName": "图标包ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；内部稳定ID"
      },
      {
        "name": "result_status",
        "displayName": "应用结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "P0；success/partial/failed/cancelled"
      }
    ]
  },
  {
    "id": "launcher:launcher_theme_apply_result",
    "name": "launcher_theme_apply_result",
    "displayName": "主题应用结果",
    "stage": "Launcher-个性化",
    "priority": "P0",
    "trackingLocation": "主题应用引擎终态回调",
    "triggerTiming": "每次应用唯一终态",
    "metricPurpose": "主题应用率/成功率",
    "parameters": [
      {
        "name": "failure_reason",
        "displayName": "失败原因",
        "dataType": "String",
        "reportingMode": "条件P0｜条件必填",
        "description": "条件P0；download_failed/incompatible/permission_denied/system_restricted/unknown"
      },
      {
        "name": "is_premium",
        "displayName": "是否付费主题",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "P1；0/1"
      },
      {
        "name": "result_status",
        "displayName": "应用结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "P0；success/failed/cancelled"
      },
      {
        "name": "theme_id",
        "displayName": "主题ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；内部稳定ID"
      }
    ]
  },
  {
    "id": "launcher:launcher_theme_view",
    "name": "launcher_theme_view",
    "displayName": "主题详情曝光",
    "stage": "Launcher-个性化",
    "priority": "P1",
    "trackingLocation": "主题详情首屏可见",
    "triggerTiming": "每次真实曝光",
    "metricPurpose": "主题曝光UV、应用转化",
    "parameters": [
      {
        "name": "entry_source",
        "displayName": "入口来源",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P1；home/store/recommend/search/unknown"
      },
      {
        "name": "launcher_session_id",
        "displayName": "桌面会话ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；本次会话复用"
      },
      {
        "name": "theme_id",
        "displayName": "主题ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P1；内部稳定ID，禁止主题名称中含PII"
      }
    ]
  },
  {
    "id": "launcher:launcher_wallpaper_apply_result",
    "name": "launcher_wallpaper_apply_result",
    "displayName": "壁纸应用结果",
    "stage": "Launcher-个性化",
    "priority": "P0",
    "trackingLocation": "壁纸应用终态回调",
    "triggerTiming": "每次应用唯一终态",
    "metricPurpose": "壁纸应用成功率",
    "parameters": [
      {
        "name": "failure_reason",
        "displayName": "失败原因",
        "dataType": "String",
        "reportingMode": "条件P0｜条件必填",
        "description": "条件P0；download_failed/incompatible/permission_denied/system_restricted/unknown"
      },
      {
        "name": "result_status",
        "displayName": "应用结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "P0；success/failed/cancelled"
      },
      {
        "name": "wallpaper_id",
        "displayName": "壁纸ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；内部稳定ID；用户本地图片传local_custom，不传路径"
      },
      {
        "name": "wallpaper_type",
        "displayName": "壁纸类型",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P1；static/live/local_custom"
      }
    ]
  },
  {
    "id": "launcher:launcher_widget_add_result",
    "name": "launcher_widget_add_result",
    "displayName": "小组件添加结果",
    "stage": "Launcher-小组件",
    "priority": "P0",
    "trackingLocation": "系统小组件绑定/添加回调",
    "triggerTiming": "每次添加尝试终态",
    "metricPurpose": "小组件添加率",
    "parameters": [
      {
        "name": "entry_source",
        "displayName": "入口来源",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P1；long_press/settings/recommend/unknown"
      },
      {
        "name": "failure_reason",
        "displayName": "失败原因",
        "dataType": "String",
        "reportingMode": "条件P0｜条件必填",
        "description": "条件P0；no_space/permission_denied/provider_error/unknown"
      },
      {
        "name": "result_status",
        "displayName": "添加结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "P0；success/failed/cancelled"
      },
      {
        "name": "widget_provider",
        "displayName": "小组件Provider",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P1；建议标准化/哈希；禁止原始敏感信息"
      },
      {
        "name": "widget_type",
        "displayName": "小组件类型",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；clock/weather/search/calendar/system/other"
      }
    ]
  },
  {
    "id": "launcher:launcher_search",
    "name": "launcher_search",
    "displayName": "桌面搜索行为",
    "stage": "Launcher-搜索",
    "priority": "P0",
    "trackingLocation": "搜索框提交/结果点击/清空/取消操作处",
    "triggerTiming": "每次有效操作",
    "metricPurpose": "搜索UV、结果点击率",
    "parameters": [
      {
        "name": "action_type",
        "displayName": "操作类型",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "P0；submit/result_click/clear/cancel"
      },
      {
        "name": "launcher_session_id",
        "displayName": "桌面会话ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；本次会话复用"
      },
      {
        "name": "search_query_length",
        "displayName": "搜索词长度",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "P0；仅长度，不得上传完整搜索词"
      },
      {
        "name": "search_result_count",
        "displayName": "结果数量",
        "dataType": "Int64",
        "reportingMode": "P0｜是",
        "description": "P1；非负整数"
      },
      {
        "name": "search_scope",
        "displayName": "搜索范围",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P1；apps/web/settings/mixed"
      }
    ]
  },
  {
    "id": "launcher:launcher_app_launch",
    "name": "launcher_app_launch",
    "displayName": "从桌面启动App",
    "stage": "Launcher-启动",
    "priority": "P0",
    "trackingLocation": "启动Intent发起并获得结果处",
    "triggerTiming": "每次有效启动尝试",
    "metricPurpose": "人均启动次数、来源分布",
    "parameters": [
      {
        "name": "launch_source",
        "displayName": "启动来源",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；home/folder/search/recent/gesture"
      },
      {
        "name": "launcher_session_id",
        "displayName": "桌面会话ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；本次会话复用"
      },
      {
        "name": "result_status",
        "displayName": "启动结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "P1；success/failed"
      },
      {
        "name": "target_app_category",
        "displayName": "目标App分类",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P1；game/social/tool/video/finance/other/unknown"
      },
      {
        "name": "target_app_id_hash",
        "displayName": "目标App标识哈希",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P2；仅业务确需时传稳定加盐哈希，不传明文包名"
      }
    ]
  },
  {
    "id": "launcher:launcher_folder_create",
    "name": "launcher_folder_create",
    "displayName": "创建文件夹",
    "stage": "Launcher-文件夹",
    "priority": "P1",
    "trackingLocation": "文件夹模型保存成功后",
    "triggerTiming": "创建成功时",
    "metricPurpose": "文件夹创建UV",
    "parameters": [
      {
        "name": "create_method",
        "displayName": "创建方式",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P1；drag_drop/menu/auto_group"
      },
      {
        "name": "folder_app_count",
        "displayName": "文件夹App数量",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "P1；非负整数"
      },
      {
        "name": "launcher_session_id",
        "displayName": "桌面会话ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；本次会话复用"
      }
    ]
  },
  {
    "id": "launcher:launcher_folder_edit",
    "name": "launcher_folder_edit",
    "displayName": "编辑文件夹",
    "stage": "Launcher-文件夹",
    "priority": "P0",
    "trackingLocation": "文件夹模型变更保存成功后",
    "triggerTiming": "每次有效编辑",
    "metricPurpose": "文件夹编辑UV",
    "parameters": [
      {
        "name": "action_type",
        "displayName": "操作类型",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "P0；add_app/remove_app/rename/delete/reorder"
      },
      {
        "name": "changed_app_count",
        "displayName": "本次变化数量",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "P2；非负整数"
      },
      {
        "name": "folder_app_count",
        "displayName": "操作后App数量",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "P1；非负整数"
      },
      {
        "name": "launcher_session_id",
        "displayName": "桌面会话ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；本次会话复用"
      }
    ]
  },
  {
    "id": "launcher:launcher_home_gesture",
    "name": "launcher_home_gesture",
    "displayName": "桌面手势",
    "stage": "Launcher-手势",
    "priority": "P0",
    "trackingLocation": "手势识别并完成动作分发后",
    "triggerTiming": "每次识别终态",
    "metricPurpose": "手势使用率/成功率",
    "parameters": [
      {
        "name": "gesture_result",
        "displayName": "手势结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "P1；success/ignored/failed"
      },
      {
        "name": "gesture_type",
        "displayName": "手势类型",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；swipe_up/swipe_down/double_tap/pinch/long_press/other"
      },
      {
        "name": "launcher_session_id",
        "displayName": "桌面会话ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；本次会话复用"
      },
      {
        "name": "target_action",
        "displayName": "目标动作",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "P1；app_drawer/search/notification/lock/settings/none/other"
      }
    ]
  },
  {
    "id": "launcher:launcher_retention_checkpoint",
    "name": "launcher_retention_checkpoint",
    "displayName": "Launcher留存节点",
    "stage": "Launcher-留存",
    "priority": "P1",
    "trackingLocation": "会话启动时由客户端或服务端规则判定",
    "triggerTiming": "每个用户每个节点一次",
    "metricPurpose": "D1/D3/D7留存、默认桌面留存",
    "parameters": [
      {
        "name": "active_days_7d",
        "displayName": "近7日活跃天数",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "P2；0-7；可由服务端派生则客户端省略"
      },
      {
        "name": "checkpoint_day",
        "displayName": "留存节点",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "P0；0/1/3/7/14/30"
      },
      {
        "name": "is_default_launcher",
        "displayName": "是否默认桌面",
        "dataType": "Int64",
        "reportingMode": "P1｜可得必传",
        "description": "P0；0/1"
      },
      {
        "name": "launcher_session_id",
        "displayName": "桌面会话ID",
        "dataType": "String",
        "reportingMode": "P1｜可得必传",
        "description": "P0；本次会话复用"
      }
    ]
  },
  {
    "id": "launcher:network_environment_changed",
    "name": "network_environment_changed",
    "displayName": "网络环境变化",
    "stage": "网络环境",
    "priority": "P0",
    "trackingLocation": "系统网络可达性/路径监听器；Android ConnectivityManager、iOS NWPathMonitor等平台实现。",
    "triggerTiming": "仅在Wi-Fi/蜂窝有效切换、网络丢失或恢复时触发；初始快照、相同状态重复回调以及蜂窝代际/漫游/IP族/门户属性单独变化不触发；默认2秒合并去抖，VPN状态机确认中断时可立即上报。",
    "metricPurpose": "网络切换率、网络恢复率、各网络类型连接成功率、切网断连率",
    "parameters": [
      {
        "name": "change_reason",
        "displayName": "变化原因",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "wifi_to_cellular/cellular_to_wifi/lost/recovered/other/unknown"
      },
      {
        "name": "network_type",
        "displayName": "网络类型",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "wifi/cellular/ethernet/none/unknown"
      }
    ]
  },
  {
    "id": "launcher:purchase_result",
    "name": "purchase_result",
    "displayName": "支付结果",
    "stage": "付费业务",
    "priority": "P1",
    "trackingLocation": "BillingClient/StoreKit/Web支付回调的最终状态处理层。",
    "triggerTiming": "订单成功、失败、取消或超时形成最终状态时。Firebase首期正常logEvent；进入中台直传必达阶段后再要求本地持久化至服务端ACK。",
    "metricPurpose": "支付成功率、收入、商品转化、国家/渠道支付异常",
    "parameters": [
      {
        "name": "order_id",
        "displayName": "订单ID",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "订单唯一ID，用于幂等去重"
      },
      {
        "name": "product_id",
        "displayName": "商品ID",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "商店或本地商品ID"
      },
      {
        "name": "payment_channel",
        "displayName": "支付渠道",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "iap_one_time/iap_subscription/local/web"
      },
      {
        "name": "payment_platform",
        "displayName": "支付平台",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "android/ios/web/web_from_android/web_from_ios"
      },
      {
        "name": "purchase_country",
        "displayName": "支付国家",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "ISO 3166-1 alpha-2"
      },
      {
        "name": "result_status",
        "displayName": "支付状态",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "success/failed/cancelled/timeout/pending"
      },
      {
        "name": "amount",
        "displayName": "支付金额",
        "dataType": "Double",
        "reportingMode": "P2｜可选",
        "description": "纯数字，不含货币符号"
      },
      {
        "name": "currency",
        "displayName": "货币代码",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "ISO 4217，如USD"
      },
      {
        "name": "scene",
        "displayName": "触发场景",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "订阅页或功能场景枚举"
      }
    ]
  },
  {
    "id": "launcher:subscription_status_changed",
    "name": "subscription_status_changed",
    "displayName": "订阅状态变化",
    "stage": "付费业务",
    "priority": "P0",
    "trackingLocation": "Billing/StoreKit/订阅权益Provider状态变化回调。",
    "triggerTiming": "old_status与new_status真实不同且权益已应用时。",
    "metricPurpose": "权益变更量、订阅后广告误展示率、续费/过期用户变化",
    "parameters": [
      {
        "name": "old_status",
        "displayName": "原订阅状态",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "none/trial/active/grace/expired"
      },
      {
        "name": "new_status",
        "displayName": "新订阅状态",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "none/trial/active/grace/expired"
      },
      {
        "name": "change_reason",
        "displayName": "变化原因",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "purchase/renewal/expiry/refund/grace/server_sync/unknown"
      },
      {
        "name": "product_id",
        "displayName": "商品ID",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "商店稳定商品ID"
      }
    ]
  },
  {
    "id": "launcher:remote_config_result",
    "name": "remote_config_result",
    "displayName": "远程配置结果",
    "stage": "实验与配置",
    "priority": "P0",
    "trackingLocation": "Firebase Remote Config或自研配置SDK fetch/activate最终回调。",
    "triggerTiming": "每次配置拉取形成终态；进程内相同版本可去重。",
    "metricPurpose": "配置成功率、应用率、P95耗时、默认值回退率、版本覆盖",
    "parameters": [
      {
        "name": "config_version",
        "displayName": "配置版本",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "服务端发布版本"
      },
      {
        "name": "config_source",
        "displayName": "配置来源",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "remote/cache/default/fallback"
      },
      {
        "name": "fetch_result",
        "displayName": "拉取结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "success/failed/timeout/not_modified"
      },
      {
        "name": "apply_result",
        "displayName": "应用结果",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "success/failed/skipped"
      },
      {
        "name": "duration_ms",
        "displayName": "配置耗时",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "fetch到activate完成的整数毫秒"
      },
      {
        "name": "error_code",
        "displayName": "配置错误码",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "稳定机器码"
      }
    ]
  },
  {
    "id": "launcher:experiment_exposure",
    "name": "experiment_exposure",
    "displayName": "实验真实曝光",
    "stage": "实验与配置",
    "priority": "P0",
    "trackingLocation": "实验UI或策略真正应用到用户可见/可执行场景时。",
    "triggerTiming": "每实验、每变体、每会话按配置去重后触发。",
    "metricPurpose": "实验曝光UV、实验漏曝光率、变体转化与收入差异",
    "parameters": [
      {
        "name": "experiment_id",
        "displayName": "实验ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "稳定实验ID"
      },
      {
        "name": "experiment_version",
        "displayName": "实验版本",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "发布版本号"
      },
      {
        "name": "variant_id",
        "displayName": "变体ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "control/treatment或稳定变体ID"
      },
      {
        "name": "screen_name",
        "displayName": "曝光页面",
        "dataType": "String",
        "reportingMode": "P1｜可选",
        "description": "稳定页面英文枚举"
      },
      {
        "name": "exposure_source",
        "displayName": "曝光来源",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "ui/policy/config/unknown"
      }
    ]
  },
  {
    "id": "launcher:attribution_result",
    "name": "attribution_result",
    "displayName": "归因结果",
    "stage": "归因",
    "priority": "P0",
    "trackingLocation": "AppsFlyer/Adjust/Firebase等归因SDK最终回调或延迟归因更新。",
    "triggerTiming": "首次有效归因及真实归因变化时；同值不重复。",
    "metricPurpose": "归因成功率、渠道VPN连接率、素材广告浏览者比例与ARPDAU",
    "parameters": [
      {
        "name": "attribution_status",
        "displayName": "归因状态",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "organic/attributed/failed/timeout/unknown"
      },
      {
        "name": "attribution_provider",
        "displayName": "归因平台",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "adjust/appsflyer/firebase/other"
      },
      {
        "name": "media_source",
        "displayName": "媒体来源",
        "dataType": "String",
        "reportingMode": "P1｜可选",
        "description": "归因SDK稳定值；高基数仅BQ/ADB"
      },
      {
        "name": "campaign_id",
        "displayName": "Campaign ID",
        "dataType": "String",
        "reportingMode": "P1｜可选",
        "description": "稳定ID，不使用动态名称"
      },
      {
        "name": "adgroup_id",
        "displayName": "广告组ID",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "稳定ID"
      },
      {
        "name": "creative_id",
        "displayName": "素材ID",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "稳定ID"
      }
    ]
  },
  {
    "id": "launcher:consent_result",
    "name": "consent_result",
    "displayName": "隐私授权结果",
    "stage": "隐私与SDK",
    "priority": "P1",
    "trackingLocation": "Google UMP ConsentInformation/Form回调。",
    "triggerTiming": "隐私状态获取或表单完成后。",
    "metricPurpose": "授权完成率、个性化允许率、授权状态eCPM",
    "parameters": [
      {
        "name": "consent_status",
        "displayName": "授权状态",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "obtained/required/not_required/unknown"
      },
      {
        "name": "privacy_region",
        "displayName": "隐私区域",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "EEA/UK/CH/US/other/unknown"
      },
      {
        "name": "personalized_allowed",
        "displayName": "允许个性化",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "是否允许个性化广告"
      },
      {
        "name": "form_shown",
        "displayName": "是否展示表单",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "1=展示"
      },
      {
        "name": "form_result",
        "displayName": "表单结果",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "accepted/rejected/dismissed/error/not_shown"
      }
    ]
  },
  {
    "id": "launcher:ad_sdk_init_start",
    "name": "ad_sdk_init_start",
    "displayName": "广告SDK开始初始化",
    "stage": "隐私与SDK",
    "priority": "P1",
    "trackingLocation": "Application广告初始化管理器，调用MobileAds.initialize前。",
    "triggerTiming": "每进程一次。",
    "metricPurpose": "SDK初始化覆盖率、初始化遗漏用户",
    "parameters": [
      {
        "name": "consent_status",
        "displayName": "初始化时授权状态",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "初始化调用时的UMP状态"
      },
      {
        "name": "network_type",
        "displayName": "网络类型",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "wifi/cellular/none/unknown"
      }
    ]
  },
  {
    "id": "launcher:ad_sdk_init_success",
    "name": "ad_sdk_init_success",
    "displayName": "广告SDK初始化成功",
    "stage": "隐私与SDK",
    "priority": "P2",
    "trackingLocation": "MobileAds.initialize完成回调。",
    "triggerTiming": "每进程成功一次。",
    "metricPurpose": "SDK初始化成功用户率、初始化耗时",
    "parameters": [
      {
        "name": "init_duration_ms",
        "displayName": "初始化耗时",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "毫秒"
      },
      {
        "name": "sdk_version",
        "displayName": "SDK版本",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "Google Mobile Ads SDK版本"
      },
      {
        "name": "adapter_status",
        "displayName": "适配器状态摘要",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "ready/not_ready数量或摘要"
      }
    ]
  },
  {
    "id": "launcher:ad_sdk_init_failed",
    "name": "ad_sdk_init_failed",
    "displayName": "广告SDK初始化失败",
    "stage": "隐私与SDK",
    "priority": "P0",
    "trackingLocation": "初始化异常、超时或业务超时保护分支。",
    "triggerTiming": "初始化失败或超过约定超时阈值。",
    "metricPurpose": "SDK失败率、初始化错误分布",
    "parameters": [
      {
        "name": "init_duration_ms",
        "displayName": "初始化耗时",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "毫秒"
      },
      {
        "name": "error_code",
        "displayName": "初始化错误码",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "内部稳定错误码"
      }
    ]
  },
  {
    "id": "launcher:ad_eligibility_check",
    "name": "ad_eligibility_check",
    "displayName": "广告资格判断",
    "stage": "广告资格",
    "priority": "P0",
    "trackingLocation": "真实业务场景到达后，在生成opportunity_id和检查缓存之前调用AdPolicy/AdEligibilityManager。",
    "triggerTiming": "每次真实业务场景到达一次；Splash预拉、启动预拉、回前台预拉和补缓存预拉均不上报。",
    "metricPurpose": "业务场景资格通过率、资格拦截原因分布、通过后机会完整率",
    "parameters": [
      {
        "name": "eligible",
        "displayName": "是否合资格",
        "dataType": "Int64",
        "reportingMode": "P0｜是",
        "description": "1=通过并继续生成广告机会；0=不生成机会并结束本次场景广告链路"
      },
      {
        "name": "blocked_reason",
        "displayName": "资格拦截原因",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "frequency_cap/consent_not_ready/subscription_user/paid_no_ads/new_user_protection/country_disabled/version_disabled/remote_config_disabled/daily_cap/session_cap/no_network/sdk_not_initialized/risk_user/placement_disabled/other/unknown"
      },
      {
        "name": "ad_format",
        "displayName": "广告格式",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "app_open/interstitial/rewarded/banner/native"
      },
      {
        "name": "placement",
        "displayName": "广告位",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "产品定义的稳定广告位英文名"
      },
      {
        "name": "decision_id",
        "displayName": "资格决策ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "每次资格判断UUID"
      },
      {
        "name": "policy_version",
        "displayName": "广告策略版本",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "远程配置/策略版本"
      },
      {
        "name": "frequency_current",
        "displayName": "当前频控次数",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "当前窗口已展示/触发次数"
      },
      {
        "name": "frequency_limit",
        "displayName": "频控上限",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "当前窗口上限"
      }
    ]
  },
  {
    "id": "launcher:ad_opportunity",
    "name": "ad_opportunity",
    "displayName": "广告机会产生",
    "stage": "广告机会",
    "priority": "P0",
    "trackingLocation": "ad_eligibility_check返回eligible=1后立即生成opportunity_id；随后再检查缓存或发起实时请求。",
    "triggerTiming": "每次资格通过后一次；eligible=0以及Splash/补缓存预拉均不上报。",
    "metricPurpose": "合资格机会数、通过后机会完整率、机会→缓存命中/请求/展示转化",
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "资格通过后新生成UUID；贯穿缓存检查、展示和必要的实时请求"
      },
      {
        "name": "trigger_type",
        "displayName": "场景触发类型",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "app_foreground/page_transition/user_action/reward_click/timer/other"
      },
      {
        "name": "ad_format",
        "displayName": "广告格式",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "app_open/interstitial/rewarded/banner/native"
      },
      {
        "name": "placement",
        "displayName": "广告位",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "稳定英文枚举；与资格事件一致"
      },
      {
        "name": "decision_id",
        "displayName": "资格决策ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联ad_eligibility_check"
      }
    ]
  },
  {
    "id": "launcher:ad_request",
    "name": "ad_request",
    "displayName": "真实广告请求",
    "stage": "广告请求",
    "priority": "P0",
    "trackingLocation": "统一AdLoader完成并发/缓存/参数校验，生成request_id后，在实际调用AdMob load()紧前一行。",
    "triggerTiming": "每次真实调用load()都上报；请求随后成功、失败、超时或同步抛错均不撤销。仅计划请求但最终未调用load()不上报。",
    "metricPurpose": "真实SDK请求量、请求终态完整率、预拉/实时请求成功率、after IP关联率",
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "on_demand请求关联资格通过后生成的机会；Splash预拉和补缓存预拉省略"
      },
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "UUID；贯穿加载到终态"
      },
      {
        "name": "ad_format",
        "displayName": "广告格式",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "app_open/interstitial/rewarded/banner/native"
      },
      {
        "name": "ad_unit_id",
        "displayName": "广告单元ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "生产广告单元；中台可脱敏显示"
      },
      {
        "name": "placement",
        "displayName": "广告位",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "稳定英文枚举"
      },
      {
        "name": "retry_index",
        "displayName": "重试序号",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "首次0；每次重试必须生成新request_id"
      },
      {
        "name": "request_type",
        "displayName": "请求类型",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "splash_preload/cache_refill/on_demand；重试仍保持原类型并通过retry_index区分"
      },
      {
        "name": "decision_id",
        "displayName": "资格决策ID",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "on_demand请求关联ad_eligibility_check；Splash预拉和补缓存预拉省略"
      },
      {
        "name": "refill_reason",
        "displayName": "补缓存原因",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "startup/foreground/consumed/expired/invalidated/unknown；替代独立ad_cache_refill事件"
      }
    ]
  },
  {
    "id": "launcher:ad_load_success",
    "name": "ad_load_success",
    "displayName": "广告加载成功",
    "stage": "广告加载",
    "priority": "P0",
    "trackingLocation": "AdMob onAdLoaded回调。",
    "triggerTiming": "每次加载成功。",
    "metricPurpose": "加载成功率、加载耗时、广告源分布",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "关联ad_request"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "每个加载成功对象唯一"
      },
      {
        "name": "load_duration_ms",
        "displayName": "加载耗时",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "request到onAdLoaded毫秒"
      },
      {
        "name": "response_id",
        "displayName": "AdMob响应ID",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "ResponseInfo.responseId，可为空"
      },
      {
        "name": "mediation_adapter",
        "displayName": "中介适配器",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "最终加载适配器类名或规范名称"
      },
      {
        "name": "ad_source",
        "displayName": "广告源",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "AdMob/竞价网络名称"
      }
    ]
  },
  {
    "id": "launcher:ad_load_failed",
    "name": "ad_load_failed",
    "displayName": "广告加载失败",
    "stage": "广告加载",
    "priority": "P0",
    "trackingLocation": "AdMob onAdFailedToLoad回调。",
    "triggerTiming": "每次加载失败。",
    "metricPurpose": "加载失败率、错误码分布、国家/网络问题",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "关联ad_request"
      },
      {
        "name": "load_duration_ms",
        "displayName": "失败耗时",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "毫秒"
      },
      {
        "name": "error_domain",
        "displayName": "错误域",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "SDK返回domain"
      },
      {
        "name": "error_code",
        "displayName": "错误码",
        "dataType": "Int64",
        "reportingMode": "P0｜条件必填",
        "description": "SDK原始错误码"
      },
      {
        "name": "error_category",
        "displayName": "错误分类",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "引用05枚举组：error_category"
      }
    ]
  },
  {
    "id": "launcher:ad_cache_put",
    "name": "ad_cache_put",
    "displayName": "广告放入缓存",
    "stage": "广告缓存",
    "priority": "P0",
    "trackingLocation": "AdCache.put返回成功后。",
    "triggerTiming": "缓存由空变为可用时触发；同一广告位不得同时维护多个有效广告对象。",
    "metricPurpose": "缓存建立成功率、缓存使用率",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "原加载请求ID"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告实例ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "已加载实例ID"
      },
      {
        "name": "ttl_ms",
        "displayName": "缓存TTL",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "本次广告对象有效期毫秒；固定TTL由配置维表维护，不要求每次事件重复上传"
      }
    ]
  },
  {
    "id": "launcher:ad_cache_hit",
    "name": "ad_cache_hit",
    "displayName": "缓存命中",
    "stage": "广告缓存",
    "priority": "P0",
    "trackingLocation": "AdCache.takeValidAd完成检查且命中后。",
    "triggerTiming": "每次机会检查缓存命中时。",
    "metricPurpose": "缓存命中率、命中后展示率",
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "当前机会"
      },
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "缓存实例原请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "实例ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "命中实例"
      }
    ]
  },
  {
    "id": "launcher:ad_cache_miss",
    "name": "ad_cache_miss",
    "displayName": "缓存未命中",
    "stage": "广告缓存",
    "priority": "P1",
    "trackingLocation": "AdCache.takeValidAd完成检查且未命中后。",
    "triggerTiming": "每次机会检查缓存未命中时。",
    "metricPurpose": "缓存未命中率、机会无广告率",
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "当前机会"
      },
      {
        "name": "miss_reason",
        "displayName": "未命中原因",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "empty/loading/expired/format_mismatch/placement_mismatch"
      }
    ]
  },
  {
    "id": "launcher:ad_cache_take",
    "name": "ad_cache_take",
    "displayName": "取出缓存实例",
    "stage": "广告缓存",
    "priority": "P0",
    "trackingLocation": "缓存原子take成功后、show前。",
    "triggerTiming": "每次有效缓存被锁定消费时。",
    "metricPurpose": "缓存使用率、实例消费完整率",
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "当前机会"
      },
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "实例原请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "实例ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "被取出实例"
      }
    ]
  },
  {
    "id": "launcher:ad_cache_expired",
    "name": "ad_cache_expired",
    "displayName": "缓存过期",
    "stage": "广告缓存",
    "priority": "P0",
    "trackingLocation": "缓存检查器实际判定过期并移除时。",
    "triggerTiming": "每次过期。",
    "metricPurpose": "缓存过期率",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "实例原请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "实例ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "过期实例"
      }
    ]
  },
  {
    "id": "launcher:ad_show_attempt",
    "name": "ad_show_attempt",
    "displayName": "尝试展示广告",
    "stage": "广告展示",
    "priority": "P0",
    "trackingLocation": "统一AdPresenter中，调用ad.show(activity)之前。",
    "triggerTiming": "每次show调用前；先校验Activity、前台、频控和全屏互斥。",
    "metricPurpose": "展示触发率、Load→Show耗时、广告对象消费率",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联对象"
      },
      {
        "name": "activity_state",
        "displayName": "Activity状态",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "resumed/paused/destroyed/unknown"
      },
      {
        "name": "app_state",
        "displayName": "App状态",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "foreground/background"
      },
      {
        "name": "trigger_type",
        "displayName": "展示触发类型",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "继承机会触发类型"
      }
    ]
  },
  {
    "id": "launcher:ad_show_success",
    "name": "ad_show_success",
    "displayName": "广告开始展示",
    "stage": "广告展示",
    "priority": "P0",
    "trackingLocation": "FullScreenContentCallback.onAdShowedFullScreenContent。",
    "triggerTiming": "SDK回调时。",
    "metricPurpose": "Show成功率、Show失败排查",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "关联对象"
      }
    ]
  },
  {
    "id": "launcher:ad_show_failed",
    "name": "ad_show_failed",
    "displayName": "广告展示失败",
    "stage": "广告展示",
    "priority": "P0",
    "trackingLocation": "FullScreenContentCallback.onAdFailedToShowFullScreenContent。",
    "triggerTiming": "SDK回调时，记录终态并释放对象。",
    "metricPurpose": "Show失败率、错误码分布",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "关联对象"
      },
      {
        "name": "error_domain",
        "displayName": "错误域",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "SDK返回domain"
      },
      {
        "name": "error_code",
        "displayName": "错误码",
        "dataType": "Int64",
        "reportingMode": "P0｜条件必填",
        "description": "SDK原始错误码"
      }
    ]
  },
  {
    "id": "launcher:ad_show_blocked",
    "name": "ad_show_blocked",
    "displayName": "广告展示被阻止",
    "stage": "广告展示",
    "priority": "P0",
    "trackingLocation": "统一AdPresenter/展示协调层：已绑定request与广告实例后、调用平台展示API前的最终校验分支；包括页面已离开、App后台/无可用展示上下文、广告过期、全屏互斥、实例被取消等。",
    "triggerTiming": "仅当已有request_id和ad_instance_id，且确定该广告实例不会进入show时触发；一个广告实例只记录一个未展示终态。",
    "metricPurpose": "未展示请求归因、user_left_page率、app_background率、过期率",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "必填；来自已完成load的原始请求，禁止临时补造"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "必填；来自load_success后的广告对象，禁止临时补造"
      },
      {
        "name": "blocked_reason",
        "displayName": "阻止原因",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "引用05枚举组：blocked_reason；仅使用标注为ad_show_blocked（已加载后展示前）适用的值"
      },
      {
        "name": "from_screen",
        "displayName": "来源页面",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "广告触发页面"
      },
      {
        "name": "to_screen",
        "displayName": "目标页面",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "App内跳转目标；后台可为空"
      },
      {
        "name": "loaded_to_block_ms",
        "displayName": "加载到阻止耗时",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "毫秒"
      },
      {
        "name": "app_state",
        "displayName": "App状态",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "foreground/background"
      }
    ]
  },
  {
    "id": "launcher:ad_impression",
    "name": "ad_impression",
    "displayName": "广告产生展示",
    "stage": "广告展示",
    "priority": "P0",
    "trackingLocation": "FullScreenContentCallback.onAdImpression；Banner使用AdListener.onAdImpression。",
    "triggerTiming": "每次SDK Impression回调。Firebase首期直接按规范上报；中台直传必达阶段才要求本地持久化/ACK。",
    "metricPurpose": "广告浏览者、Impression、人均展示、端到端展示率",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联对象"
      },
      {
        "name": "ad_source",
        "displayName": "广告源",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "最终展示广告源"
      },
      {
        "name": "mediation_adapter",
        "displayName": "中介适配器",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "最终适配器"
      }
    ]
  },
  {
    "id": "launcher:ad_click",
    "name": "ad_click",
    "displayName": "广告点击",
    "stage": "广告展示",
    "priority": "P0",
    "trackingLocation": "FullScreenContentCallback.onAdClicked；Banner AdListener.onAdClicked。",
    "triggerTiming": "SDK点击回调。",
    "metricPurpose": "点击数、CTR、异常点击风险",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联对象"
      }
    ]
  },
  {
    "id": "launcher:ad_reward_earned",
    "name": "ad_reward_earned",
    "displayName": "激励奖励获得",
    "stage": "广告展示",
    "priority": "P0",
    "trackingLocation": "RewardedAd.show的OnUserEarnedRewardListener。",
    "triggerTiming": "用户获得奖励时。",
    "metricPurpose": "奖励完成率、激励漏发/异常",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联请求"
      },
      {
        "name": "reward_type",
        "displayName": "奖励类型",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "产品定义，如free_time/coin"
      },
      {
        "name": "reward_amount",
        "displayName": "奖励数量",
        "dataType": "Double",
        "reportingMode": "P1｜条件必填",
        "description": "实际发放值"
      }
    ]
  },
  {
    "id": "launcher:ad_dismissed",
    "name": "ad_dismissed",
    "displayName": "广告关闭",
    "stage": "广告展示",
    "priority": "P0",
    "trackingLocation": "FullScreenContentCallback.onAdDismissedFullScreenContent。",
    "triggerTiming": "SDK关闭回调；释放对象并按策略预加载下一条。",
    "metricPurpose": "广告停留时长、关闭率、后续行为",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联对象"
      }
    ]
  },
  {
    "id": "launcher:ad_paid_event",
    "name": "ad_paid_event",
    "displayName": "广告价值回传",
    "stage": "广告收入",
    "priority": "P0",
    "trackingLocation": "OnPaidEventListener；广告对象创建后立即绑定。",
    "triggerTiming": "SDK Paid Event回调并高优先级上报。Firebase首期不要求本地必达队列；中台直传必达阶段再启用持久化/ACK。",
    "metricPurpose": "广告收入、eCPM、ARPDAU、国家/广告位收入",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联对象"
      },
      {
        "name": "value_micros",
        "displayName": "收入微单位",
        "dataType": "Int64",
        "reportingMode": "P0｜是",
        "description": "实际货币值×1,000,000"
      },
      {
        "name": "currency_code",
        "displayName": "币种",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "ISO 4217，例如USD"
      },
      {
        "name": "precision_type",
        "displayName": "精度类型",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "unknown/estimated/publisher_provided/precise"
      },
      {
        "name": "ad_source",
        "displayName": "广告源",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "最终收入来源"
      },
      {
        "name": "mediation_adapter",
        "displayName": "中介适配器",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "最终适配器"
      }
    ]
  },
  {
    "id": "launcher:banner_visible",
    "name": "banner_visible",
    "displayName": "Banner实际可见",
    "stage": "Banner专项",
    "priority": "P0",
    "trackingLocation": "AdView挂载后结合View可见性、窗口焦点和可视区域监听。",
    "triggerTiming": "可见状态变化；避免高频抖动，建议状态切换触发。",
    "metricPurpose": "Banner可见率、加载未展示原因、有效曝光时长",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "关联Banner请求"
      },
      {
        "name": "is_visible",
        "displayName": "是否实际可见",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "可见且未被遮挡的业务判断"
      },
      {
        "name": "visibility_reason",
        "displayName": "不可见原因",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "detached/covered/offscreen/page_hidden/app_background/size_zero/unknown"
      },
      {
        "name": "visible_duration_ms",
        "displayName": "本次可见时长",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "毫秒"
      }
    ]
  },
  {
    "id": "launcher:api_request_result",
    "name": "api_request_result",
    "displayName": "接口请求结果",
    "stage": "接口质量",
    "priority": "P0",
    "trackingLocation": "统一HTTP拦截器在响应、异常或超时终态处。",
    "triggerTiming": "每次请求结束。",
    "metricPurpose": "接口成功率、错误码、国家/版本网络异常、接口耗时",
    "parameters": [
      {
        "name": "api_name",
        "displayName": "接口名称",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "稳定接口枚举，不直接用包含参数的完整URL"
      },
      {
        "name": "success",
        "displayName": "是否成功",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "true/false"
      },
      {
        "name": "http_code",
        "displayName": "HTTP状态码",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "无响应时为0"
      },
      {
        "name": "duration_ms",
        "displayName": "接口耗时",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "请求开始到终态的毫秒数"
      },
      {
        "name": "error_stage",
        "displayName": "失败阶段",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "dns/connect/tls/timeout/http/business/parse"
      },
      {
        "name": "error_code",
        "displayName": "错误码",
        "dataType": "String",
        "reportingMode": "P0｜条件必填",
        "description": "客户端或服务端标准错误码"
      },
      {
        "name": "request_trace_id",
        "displayName": "接口追踪ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "同一业务请求及其重试共享"
      },
      {
        "name": "retry_index",
        "displayName": "接口重试序号",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "首次0，后续递增"
      }
    ]
  },
  {
    "id": "launcher:context_provider_unavailable",
    "name": "context_provider_unavailable",
    "displayName": "上下文Provider不可用",
    "stage": "数据质量",
    "priority": "P0",
    "trackingLocation": "统一Analytics Context Provider读取公共/条件字段失败处。",
    "triggerTiming": "核心Provider首次失败、状态变化或按分钟聚合后触发，禁止每字段无限刷事件。",
    "metricPurpose": "Provider可用率、字段缺失归因、P0/P1完整率解释",
    "parameters": [
      {
        "name": "provider_name",
        "displayName": "Provider名称",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "稳定Provider英文名"
      },
      {
        "name": "field_name",
        "displayName": "不可用字段",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "标准字段名"
      },
      {
        "name": "availability_reason",
        "displayName": "不可用原因",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "permission_denied/sdk_not_ready/platform_unsupported/timeout/privacy_restricted/unknown"
      },
      {
        "name": "error_code",
        "displayName": "Provider错误码",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "稳定短错误码"
      }
    ]
  },
  {
    "id": "launcher:telemetry_batch_send",
    "name": "telemetry_batch_send",
    "displayName": "中台批次发送",
    "stage": "上报健康",
    "priority": "P1",
    "trackingLocation": "Telemetry SDK网络发送器；请求发出前。",
    "triggerTiming": "每个批次发送前；健康摘要可同时发Firebase。",
    "metricPurpose": "发送批次、事件发送量、积压程度、重试分布",
    "parameters": [
      {
        "name": "batch_id",
        "displayName": "批次ID",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "一次HTTP批次唯一ID"
      },
      {
        "name": "event_count",
        "displayName": "批次事件数",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "本批次事件条数"
      }
    ]
  },
  {
    "id": "launcher:telemetry_batch_failed",
    "name": "telemetry_batch_failed",
    "displayName": "中台批次失败",
    "stage": "上报健康",
    "priority": "P2",
    "trackingLocation": "Telemetry SDK网络异常或服务端非成功响应回调。",
    "triggerTiming": "每次发送失败；进入本地重试队列。",
    "metricPurpose": "上报失败率、错误分布、版本/国家/网络异常",
    "parameters": [
      {
        "name": "batch_id",
        "displayName": "批次ID",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "关联发送批次"
      },
      {
        "name": "error_type",
        "displayName": "失败类型",
        "dataType": "String",
        "reportingMode": "P2｜可选",
        "description": "dns_failed/connect_timeout/read_timeout/ssl_error/http_4xx/http_5xx/network_unavailable/invalid_response/unknown"
      },
      {
        "name": "http_status",
        "displayName": "HTTP状态",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "无响应填0"
      },
      {
        "name": "request_duration_ms",
        "displayName": "失败耗时",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "毫秒"
      },
      {
        "name": "queue_size",
        "displayName": "当前队列长度",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "失败后待重试事件数"
      },
      {
        "name": "oldest_event_age_ms",
        "displayName": "最老事件年龄",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "毫秒"
      }
    ]
  },
  {
    "id": "launcher:telemetry_backend_ack",
    "name": "telemetry_backend_ack",
    "displayName": "中台ACK结果",
    "stage": "上报健康",
    "priority": "P1",
    "trackingLocation": "BackendUploader解析服务端ACK后。",
    "triggerTiming": "每个收到有效ACK的批次一次；2xx但ACK无效必须走telemetry_batch_failed。",
    "metricPurpose": "ACK成功率、最终送达率",
    "parameters": [
      {
        "name": "batch_id",
        "displayName": "批次ID",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "本次上传批次"
      },
      {
        "name": "accepted_count",
        "displayName": "接收数量",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "服务端accepted数量"
      },
      {
        "name": "rejected_count",
        "displayName": "拒绝数量",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "服务端rejected数量"
      },
      {
        "name": "ack_duration_ms",
        "displayName": "ACK耗时",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "发送到收到ACK的毫秒数"
      },
      {
        "name": "http_status",
        "displayName": "HTTP状态",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "有效ACK对应的2xx状态码"
      },
      {
        "name": "request_duration_ms",
        "displayName": "请求耗时",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "发送开始至有效ACK校验完成的整数毫秒"
      },
      {
        "name": "queue_size_after",
        "displayName": "ACK后队列长度",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "accepted事件出队后的本地队列长度"
      }
    ]
  },
  {
    "id": "launcher:telemetry_event_enqueued",
    "name": "telemetry_event_enqueued",
    "displayName": "事件进入本地队列",
    "stage": "上报健康",
    "priority": "P0",
    "trackingLocation": "AnalyticsRepository写入本地outbox事务成功后。",
    "triggerTiming": "中台直传必达阶段每条关键事件入队成功时。",
    "metricPurpose": "入队成功率、生成→发送漏损",
    "parameters": [
      {
        "name": "original_event_id",
        "displayName": "原事件ID",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "关联原业务事件event_id"
      },
      {
        "name": "original_event_name",
        "displayName": "原事件名",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "标准事件名"
      },
      {
        "name": "priority",
        "displayName": "队列优先级",
        "dataType": "String",
        "reportingMode": "P1｜条件必填",
        "description": "p0/p1/p2"
      }
    ]
  },
  {
    "id": "launcher:telemetry_event_dropped",
    "name": "telemetry_event_dropped",
    "displayName": "事件最终丢弃",
    "stage": "上报健康",
    "priority": "P0",
    "trackingLocation": "统一埋点SDK/outbox最终丢弃分支。",
    "triggerTiming": "超过最大重试、队列淘汰或载荷校验失败时。",
    "metricPurpose": "事件丢弃率、丢弃原因分布",
    "parameters": [
      {
        "name": "original_event_name",
        "displayName": "原事件名",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "被丢弃的标准事件名"
      },
      {
        "name": "drop_reason",
        "displayName": "丢弃原因",
        "dataType": "String",
        "reportingMode": "P0｜是",
        "description": "queue_full/max_retry/invalid_payload/oversize/privacy_blocked/unknown"
      },
      {
        "name": "retry_count",
        "displayName": "重试次数",
        "dataType": "Int64",
        "reportingMode": "P1｜条件必填",
        "description": "整数"
      },
      {
        "name": "queue_size",
        "displayName": "队列长度",
        "dataType": "Int64",
        "reportingMode": "P2｜可选",
        "description": "丢弃发生时队列长度"
      }
    ]
  }
] as const;
