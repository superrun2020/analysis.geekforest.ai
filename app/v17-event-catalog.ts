export type V17EventParameter = {
  name: string;
  displayName: string;
  dataType: string;
  reportingMode: string;
  description: string;
};

export type V17StandardEvent = {
  id: string;
  module: string;
  standardEventName: string;
  displayName: string;
  analysisGoal: string;
  platforms: string;
  trackingLocation: string;
  triggerTiming: string;
  metricPurpose: string;
  sourceAlias: string;
  parameters: V17EventParameter[];
};

export const v17EventSource = {
  "workbook": "JKCL跨团队埋点规范_V1.7_公共参数一次性参数版.xlsx",
  "sheet": "01_事件字段总表",
  "extractedEventCount": 44,
  "parameterRowCount": 209
} as const;

export const v17StandardEvents: V17StandardEvent[] = [
  {
    "id": "V17-EVT-001",
    "module": "App生命周期",
    "standardEventName": "app_background",
    "displayName": "进入后台",
    "analysisGoal": "整个App失去前台状态，不等于离开当前页面。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "App lifecycle observer检测整个App进入后台；Android可映射ProcessLifecycleOwner，iOS映射UIApplication/Scene lifecycle。不得用单页面离开替代App后台。",
    "triggerTiming": "按Home、切换App、锁屏等导致整个App进入后台。",
    "metricPurpose": "会话时长、短会话率、后台导致广告未展示比例",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "current_screen",
        "displayName": "当前页面",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "进入后台前最后可见页面"
      },
      {
        "name": "session_duration_ms",
        "displayName": "会话时长",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "本次前台会话持续毫秒数"
      },
      {
        "name": "background_reason",
        "displayName": "后台原因",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "home_or_switch_app/screen_off/system_interruption/unknown"
      },
      {
        "name": "pending_ad_count",
        "displayName": "待消费广告数",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "已加载但未产生终态的广告对象数量"
      }
    ]
  },
  {
    "id": "V17-EVT-002",
    "module": "App生命周期",
    "standardEventName": "app_first_open",
    "displayName": "首次打开",
    "analysisGoal": "安装后第一次启动，用于安装、首开和新用户识别。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Application启动初始化层；本地持久化first_open_sent=false时触发。",
    "triggerTiming": "每次安装仅一次；Firebase首期由本地first_open_sent标记保证一次性触发并直接logEvent；中台直传必达阶段才先写入本地outbox，服务端ACK后出队。",
    "metricPurpose": "首开用户、安装→首开率、新增用户、渠道首开率",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "install_time",
        "displayName": "安装时间",
        "dataType": "timestamp",
        "reportingMode": "首次触发",
        "description": "首次安装时间；没有可靠安装时间时取首次启动时间"
      },
      {
        "name": "is_reinstall",
        "displayName": "是否重装",
        "dataType": "bool",
        "reportingMode": "首次触发",
        "description": "1=可能重装；0=首次安装；仅作辅助判断"
      },
      {
        "name": "install_source",
        "displayName": "安装来源",
        "dataType": "str",
        "reportingMode": "首次触发",
        "description": "Google Play、第三方商店、预装、未知"
      }
    ]
  },
  {
    "id": "V17-EVT-003",
    "module": "App生命周期",
    "standardEventName": "app_once_params",
    "displayName": "一次性参数",
    "analysisGoal": "SDK初始化后记录本次运行环境和功能快照，避免每条事件重复上报。",
    "platforms": "Android/iOS",
    "trackingLocation": "统一Analytics/SDK初始化完成后；远程配置应用状态以当前快照为准。",
    "triggerTiming": "每进程一次；SDK初始化完成后触发。",
    "metricPurpose": "运行环境分群、问题定位、远程配置生效判断",
    "sourceAlias": "V1.7公共参数/一次性参数调整",
    "parameters": [
      {
        "name": "consent_status",
        "displayName": "隐私授权状态",
        "dataType": "str",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "SDK初始化后一次性快照；授权变化另由 consent_result 事件记录。"
      },
      {
        "name": "personalized_allowed",
        "displayName": "是否允许个性化广告",
        "dataType": "bool",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "SDK初始化后一次性快照；可得时传。"
      },
      {
        "name": "ip_before_connect",
        "displayName": "VPN连接前公网IP",
        "dataType": "str",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "Firebase不传明文；自有中台vpnSessionContext保存"
      },
      {
        "name": "country_code",
        "displayName": "启动国家/地区码",
        "dataType": "str",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "启动时识别国家/地区；优先 IP 定位或业务 Provider。"
      },
      {
        "name": "city",
        "displayName": "启动城市",
        "dataType": "str",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "启动时 IP 定位城市；可得时传。"
      },
      {
        "name": "device_model",
        "displayName": "设备型号",
        "dataType": "str",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "设备型号；Firebase自动可得时客户端不重复作为普通公共参数。"
      },
      {
        "name": "os_name",
        "displayName": "操作系统",
        "dataType": "str",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "如 iOS/Android。"
      },
      {
        "name": "os_version",
        "displayName": "系统版本",
        "dataType": "str",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "系统版本；Firebase自动可得时客户端不重复作为普通公共参数。"
      },
      {
        "name": "app_version",
        "displayName": "App版本",
        "dataType": "str",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "App版本；Firebase自动可得时客户端不重复作为普通公共参数。"
      },
      {
        "name": "app_build",
        "displayName": "构建号",
        "dataType": "int",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "App build/versionCode；SDK初始化后一次性传。"
      },
      {
        "name": "locale_language",
        "displayName": "本地语言",
        "dataType": "str",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "系统语言；需要原始客户端值时在一次性参数中传。"
      },
      {
        "name": "locale_country",
        "displayName": "本地国家",
        "dataType": "str",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "系统地区；启动环境快照。"
      },
      {
        "name": "timezone",
        "displayName": "客户端时区",
        "dataType": "str",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "IANA时区或UTC offset；启动环境快照。"
      },
      {
        "name": "open_times",
        "displayName": "安装后打开次数",
        "dataType": "int",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "从1开始；本次启动维度。"
      },
      {
        "name": "is_subscriber",
        "displayName": "是否订阅用户",
        "dataType": "bool",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "SDK初始化时订阅状态快照；不确定时不伪造。"
      },
      {
        "name": "remote_config_applied",
        "displayName": "远程配置是否已应用",
        "dataType": "bool",
        "reportingMode": "SDK初始化后每进程一次",
        "description": "true 表示本次已经拿到并应用 Firebase Remote Config；false 表示仍用默认/兜底配置。"
      }
    ]
  },
  {
    "id": "V17-EVT-004",
    "module": "App生命周期",
    "standardEventName": "app_foreground",
    "displayName": "进入前台",
    "analysisGoal": "中台DAU的基准事件，代表App进入可交互前台。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "App lifecycle observer检测整个App进入前台；Android/iOS按各自生命周期API实现。",
    "triggerTiming": "每次进程从后台进入前台；首次启动也触发。",
    "metricPurpose": "中台DAU、会话数、回访率、Firebase DAU对账",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "foreground_reason",
        "displayName": "进入前台原因",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "first_open/resume/notification/deep_link/unknown"
      },
      {
        "name": "previous_background_ms",
        "displayName": "上次后台时长",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "毫秒；首次会话为0"
      },
      {
        "name": "session_index",
        "displayName": "安装后会话序号",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "从1开始递增"
      },
      {
        "name": "launch_type",
        "displayName": "启动类型",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "cold_start/resume"
      }
    ]
  },
  {
    "id": "V17-EVT-005",
    "module": "App生命周期",
    "standardEventName": "session_heartbeat",
    "displayName": "前台心跳",
    "analysisGoal": "验证长会话和中台上报链路，避免进程被杀导致会话结束丢失。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Application前台定时任务；仅前台运行。",
    "triggerTiming": "前台每3~5分钟一次；进入后台立即停止。",
    "metricPurpose": "有效活跃时长、心跳覆盖率、上报中断用户",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "foreground_duration_ms",
        "displayName": "累计前台时长",
        "dataType": "int",
        "reportingMode": "定时触发",
        "description": "当前会话累计前台毫秒"
      },
      {
        "name": "queue_size",
        "displayName": "本地事件队列长度",
        "dataType": "int",
        "reportingMode": "定时触发",
        "description": "仅中台直传/必达链路适用；Firebase首期无outbox时省略"
      }
    ]
  },
  {
    "id": "V17-EVT-006",
    "module": "页面行为",
    "standardEventName": "element_click",
    "displayName": "元素点击",
    "analysisGoal": "统一所有页面按钮、Tab、滑动和业务入口点击，避免为每个按钮创建独立事件。",
    "platforms": "Android/iOS",
    "trackingLocation": "统一UI点击代理层、Compose Modifier.clickable、View.OnClickListener或导航组件点击封装。",
    "triggerTiming": "用户真实完成一次点击/滑动动作时。",
    "metricPurpose": "元素点击PV/UV、页面点击率、关键路径转化",
    "sourceAlias": "element_click及全部iwxcleaner_*_click历史事件",
    "parameters": [
      {
        "name": "element_name",
        "displayName": "元素名称",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "稳定英文枚举，不上传动态文案"
      },
      {
        "name": "action_name",
        "displayName": "动作名称",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "continue/delete/merge/back/swipe_up等标准动作"
      },
      {
        "name": "content_type",
        "displayName": "业务内容类型",
        "dataType": "str",
        "reportingMode": "按需触发",
        "description": "photo/video/contacts/calendar/private等"
      },
      {
        "name": "scene",
        "displayName": "业务场景",
        "dataType": "str",
        "reportingMode": "按需触发",
        "description": "订阅或功能触发场景"
      },
      {
        "name": "ui_style",
        "displayName": "页面样式",
        "dataType": "str",
        "reportingMode": "按需触发",
        "description": "A/B/C或实验样式"
      },
      {
        "name": "page_index",
        "displayName": "流程页序号",
        "dataType": "int",
        "reportingMode": "按需触发",
        "description": "引导页等流程从1开始"
      },
      {
        "name": "tab_name",
        "displayName": "Tab名称",
        "dataType": "str",
        "reportingMode": "按需触发",
        "description": "稳定英文Tab枚举"
      },
      {
        "name": "content_month",
        "displayName": "内容月份",
        "dataType": "str",
        "reportingMode": "按需触发",
        "description": "统一YYYY-MM格式"
      }
    ]
  },
  {
    "id": "V17-EVT-007",
    "module": "页面行为",
    "standardEventName": "screen_exit",
    "displayName": "离开页面",
    "analysisGoal": "用户离开当前广告场景；App可能仍在前台。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "统一Navigation监听器；Fragment.onDestroyView；Compose DisposableEffect.onDispose。",
    "triggerTiming": "页面退出时；延迟300~500ms结合App状态归因。",
    "metricPurpose": "页面停留、user_left_page广告损耗、退出路径",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "screen_name",
        "displayName": "离开页面",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "原页面名称"
      },
      {
        "name": "next_screen",
        "displayName": "目标页面",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "App内目标页面；进入后台可为空"
      },
      {
        "name": "exit_action",
        "displayName": "退出动作",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "back/tab_switch/navigate/close/flow_cancelled"
      },
      {
        "name": "screen_duration_ms",
        "displayName": "页面停留时长",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "页面可见到退出的毫秒数"
      },
      {
        "name": "app_state",
        "displayName": "App状态",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "foreground/background；用于区分用户离页和App后台"
      }
    ]
  },
  {
    "id": "V17-EVT-008",
    "module": "页面行为",
    "standardEventName": "screen_view",
    "displayName": "页面展示",
    "analysisGoal": "识别用户是否进入广告所在页面及页面深度。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Navigation destination监听器；Compose页面LaunchedEffect；Fragment首次可见。",
    "triggerTiming": "页面真正可见时，每次进入触发。",
    "metricPurpose": "页面UV/PV、页面到达率、广告场景覆盖率",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "screen_name",
        "displayName": "页面名称",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "统一页面英文枚举"
      },
      {
        "name": "previous_screen",
        "displayName": "来源页面",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "上一页面；首次为空"
      },
      {
        "name": "screen_index",
        "displayName": "会话页面序号",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "本次会话第几个页面"
      },
      {
        "name": "page_state",
        "displayName": "页面状态",
        "dataType": "str",
        "reportingMode": "按需触发",
        "description": "accepted/not_accept/completed/unfinished/have/none等迁移后标准枚举"
      },
      {
        "name": "ui_style",
        "displayName": "页面样式",
        "dataType": "str",
        "reportingMode": "按需触发",
        "description": "A/B/C或实验样式"
      },
      {
        "name": "content_month",
        "displayName": "内容月份",
        "dataType": "str",
        "reportingMode": "按需触发",
        "description": "统一YYYY-MM"
      }
    ]
  },
  {
    "id": "V17-EVT-009",
    "module": "核心行为",
    "standardEventName": "business_task_completed",
    "displayName": "业务任务完成",
    "analysisGoal": "统一清理扫描等异步业务任务完成结果。",
    "platforms": "Android/iOS",
    "trackingLocation": "业务UseCase/Repository返回最终结果后。",
    "triggerTiming": "任务成功、失败或取消形成终态时。",
    "metricPurpose": "任务完成率、耗时、业务功能使用UV",
    "sourceAlias": "iwxcleaner_scan_completed",
    "parameters": [
      {
        "name": "task_type",
        "displayName": "任务类型",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "clean_scan等稳定业务枚举"
      },
      {
        "name": "result_status",
        "displayName": "任务状态",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "completed/failed/cancelled"
      },
      {
        "name": "duration_ms",
        "displayName": "任务耗时",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "整数毫秒"
      },
      {
        "name": "item_count",
        "displayName": "处理对象数",
        "dataType": "int",
        "reportingMode": "按需触发",
        "description": "扫描或处理的对象数量"
      }
    ]
  },
  {
    "id": "V17-EVT-010",
    "module": "核心行为",
    "standardEventName": "core_action",
    "displayName": "核心功能行为",
    "analysisGoal": "记录VPN连接、节点选择等核心产品动作，判断广告机会前置行为是否完成。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "业务UseCase/Repository成功或失败结果回调，不在按钮点击即认定成功。",
    "triggerTiming": "每个核心动作完成或失败时。",
    "metricPurpose": "核心行为转化、广告机会触达、用户质量",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "action_name",
        "displayName": "动作名称",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "vpn_connect/vpn_disconnect/node_select等"
      },
      {
        "name": "action_result",
        "displayName": "动作结果",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "success/failed/cancelled/blocked"
      },
      {
        "name": "duration_ms",
        "displayName": "动作耗时",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "动作开始到终态毫秒数"
      },
      {
        "name": "error_code",
        "displayName": "业务错误码",
        "dataType": "str",
        "reportingMode": "失败时触发",
        "description": "稳定机器码，成功为空"
      }
    ]
  },
  {
    "id": "V17-EVT-011",
    "module": "VPN业务",
    "standardEventName": "vpn_connection_result",
    "displayName": "VPN连接结果",
    "analysisGoal": "判断核心功能完成率、连接耗时及连接成功后广告机会覆盖。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "VPN连接状态机最终成功/失败/禁止回调。",
    "triggerTiming": "每次连接尝试进入终态。",
    "metricPurpose": "连接成功率、连接耗时、连接→广告机会率",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "connection_id",
        "displayName": "连接ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "单次连接尝试唯一ID"
      },
      {
        "name": "vpn_status",
        "displayName": "连接结果",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "success/failed/prohibited"
      },
      {
        "name": "trigger_type",
        "displayName": "触发类型",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "connect/retry/auto_reconnect/timeout_disconnect/traffic_limit_disconnect"
      },
      {
        "name": "node_region",
        "displayName": "节点地区",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "国家或地区代码"
      },
      {
        "name": "duration_ms",
        "displayName": "连接耗时",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "开始到终态毫秒"
      },
      {
        "name": "error_code",
        "displayName": "失败错误码",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "稳定业务错误码"
      }
    ]
  },
  {
    "id": "V17-EVT-012",
    "module": "VPN业务",
    "standardEventName": "vpn_disconnection",
    "displayName": "VPN断开结果",
    "analysisGoal": "统计主动断开、异常断开、使用时长和流量。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "VPN Service断开终态回调。",
    "triggerTiming": "每次有效连接结束。",
    "metricPurpose": "连接时长、断开原因、流量、稳定性",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "connection_id",
        "displayName": "连接ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联连接"
      },
      {
        "name": "disconnect_reason",
        "displayName": "断开原因",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "user/network_error/server_error/timeout/traffic_limit/app_killed/unknown"
      },
      {
        "name": "connected_duration_ms",
        "displayName": "连接时长",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "成功连接到断开毫秒"
      },
      {
        "name": "traffic_bytes",
        "displayName": "使用流量",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "上下行合计字节数"
      },
      {
        "name": "node_region",
        "displayName": "节点地区",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "国家或地区代码"
      }
    ]
  },
  {
    "id": "V17-EVT-013",
    "module": "付费业务",
    "standardEventName": "purchase_result",
    "displayName": "支付结果",
    "analysisGoal": "统一VPN支付、订阅页支付和其他产品付款结果。",
    "platforms": "Android/iOS",
    "trackingLocation": "BillingClient/StoreKit/Web支付回调的最终状态处理层。",
    "triggerTiming": "订单成功、失败、取消或超时形成最终状态时。Firebase首期正常logEvent；进入中台直传必达阶段后再要求本地持久化至服务端ACK。",
    "metricPurpose": "支付成功率、收入、商品转化、国家/渠道支付异常",
    "sourceAlias": "vpn_payment、iwxcleaner_pay_results",
    "parameters": [
      {
        "name": "order_id",
        "displayName": "订单ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "订单唯一ID，用于幂等去重"
      },
      {
        "name": "product_id",
        "displayName": "商品ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "商店或本地商品ID"
      },
      {
        "name": "payment_channel",
        "displayName": "支付渠道",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "iap_one_time/iap_subscription/local/web"
      },
      {
        "name": "payment_platform",
        "displayName": "支付平台",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "android/ios/web/web_from_android/web_from_ios"
      },
      {
        "name": "purchase_country",
        "displayName": "支付国家",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "ISO 3166-1 alpha-2"
      },
      {
        "name": "result_status",
        "displayName": "支付状态",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "success/failed/cancelled/timeout/pending"
      },
      {
        "name": "amount",
        "displayName": "支付金额",
        "dataType": "decimal",
        "reportingMode": "金额可用时",
        "description": "纯数字，不含货币符号"
      },
      {
        "name": "currency",
        "displayName": "货币代码",
        "dataType": "str",
        "reportingMode": "金额可用时",
        "description": "ISO 4217，如USD"
      },
      {
        "name": "scene",
        "displayName": "触发场景",
        "dataType": "str",
        "reportingMode": "按需触发",
        "description": "订阅页或功能场景枚举"
      }
    ]
  },
  {
    "id": "V17-EVT-014",
    "module": "隐私与SDK",
    "standardEventName": "ad_sdk_init_failed",
    "displayName": "广告SDK初始化失败",
    "analysisGoal": "定位广告请求用户覆盖不足的SDK问题。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "初始化异常、超时或业务超时保护分支。",
    "triggerTiming": "初始化失败或超过约定超时阈值。",
    "metricPurpose": "SDK失败率、初始化错误分布",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "init_duration_ms",
        "displayName": "初始化耗时",
        "dataType": "int",
        "reportingMode": "失败触发",
        "description": "毫秒"
      },
      {
        "name": "error_code",
        "displayName": "初始化错误码",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "内部稳定错误码"
      },
      {
        "name": "error_message",
        "displayName": "初始化错误摘要",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "脱敏、限长"
      }
    ]
  },
  {
    "id": "V17-EVT-015",
    "module": "隐私与SDK",
    "standardEventName": "ad_sdk_init_start",
    "displayName": "广告SDK开始初始化",
    "analysisGoal": "判断初始化是否启动及启动时机。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Application广告初始化管理器，调用MobileAds.initialize前。",
    "triggerTiming": "每进程一次。",
    "metricPurpose": "SDK初始化覆盖率、初始化遗漏用户",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "consent_status",
        "displayName": "初始化时授权状态",
        "dataType": "str",
        "reportingMode": "每进程一次",
        "description": "初始化调用时的UMP状态"
      },
      {
        "name": "network_type",
        "displayName": "网络类型",
        "dataType": "str",
        "reportingMode": "每进程一次",
        "description": "wifi/cellular/none/unknown"
      }
    ]
  },
  {
    "id": "V17-EVT-016",
    "module": "隐私与SDK",
    "standardEventName": "ad_sdk_init_success",
    "displayName": "广告SDK初始化成功",
    "analysisGoal": "确认用户具备请求AdMob的技术条件。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "MobileAds.initialize完成回调。",
    "triggerTiming": "每进程成功一次。",
    "metricPurpose": "SDK初始化成功用户率、初始化耗时",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "init_duration_ms",
        "displayName": "初始化耗时",
        "dataType": "int",
        "reportingMode": "成功触发",
        "description": "毫秒"
      },
      {
        "name": "sdk_version",
        "displayName": "SDK版本",
        "dataType": "str",
        "reportingMode": "成功触发",
        "description": "Google Mobile Ads SDK版本"
      },
      {
        "name": "adapter_status",
        "displayName": "适配器状态摘要",
        "dataType": "str",
        "reportingMode": "成功触发",
        "description": "ready/not_ready数量或摘要"
      }
    ]
  },
  {
    "id": "V17-EVT-017",
    "module": "隐私与SDK",
    "standardEventName": "consent_result",
    "displayName": "隐私授权结果",
    "analysisGoal": "区分隐私流程造成的广告资格和eCPM差异。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Google UMP ConsentInformation/Form回调。",
    "triggerTiming": "隐私状态获取或表单完成后。",
    "metricPurpose": "授权完成率、个性化允许率、授权状态eCPM",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "consent_status",
        "displayName": "授权状态",
        "dataType": "str",
        "reportingMode": "结果触发",
        "description": "obtained/required/not_required/unknown"
      },
      {
        "name": "privacy_region",
        "displayName": "隐私区域",
        "dataType": "str",
        "reportingMode": "结果触发",
        "description": "EEA/UK/CH/US/other/unknown"
      },
      {
        "name": "personalized_allowed",
        "displayName": "允许个性化",
        "dataType": "bool",
        "reportingMode": "结果触发",
        "description": "是否允许个性化广告"
      },
      {
        "name": "form_shown",
        "displayName": "是否展示表单",
        "dataType": "bool",
        "reportingMode": "结果触发",
        "description": "1=展示"
      },
      {
        "name": "form_result",
        "displayName": "表单结果",
        "dataType": "str",
        "reportingMode": "结果触发",
        "description": "accepted/rejected/dismissed/error/not_shown"
      }
    ]
  },
  {
    "id": "V17-EVT-018",
    "module": "广告机会",
    "standardEventName": "ad_eligibility_check",
    "displayName": "广告资格判断",
    "analysisGoal": "解释DAU为什么没有进入广告机会或请求链路。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "统一AdPolicy/AdEligibilityManager；每次广告场景触发前。",
    "triggerTiming": "每次准备进入广告逻辑时，无论通过或拦截都上报。",
    "metricPurpose": "广告资格率、拦截用户率、blocked_reason分布",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "eligible",
        "displayName": "是否合资格",
        "dataType": "bool",
        "reportingMode": "每次触发",
        "description": "1=允许继续；0=被拦截"
      },
      {
        "name": "blocked_reason",
        "displayName": "拦截原因",
        "dataType": "str",
        "reportingMode": "eligible=false",
        "description": "引用05枚举组：blocked_reason；仅使用标注为ad_eligibility_check适用的值"
      },
      {
        "name": "ad_format",
        "displayName": "广告格式",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "app_open/interstitial/rewarded/banner/native"
      },
      {
        "name": "placement",
        "displayName": "广告位",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "产品定义的稳定广告位英文名"
      }
    ]
  },
  {
    "id": "V17-EVT-019",
    "module": "广告机会",
    "standardEventName": "ad_opportunity",
    "displayName": "广告机会产生",
    "analysisGoal": "记录产品逻辑上本可展示广告的节点，是分析广告浏览者比例的关键分母。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "业务触发点；例如VPN连接成功、页面切换、App回前台、领取奖励。",
    "triggerTiming": "每次广告机会产生；即使最终不请求也记录。",
    "metricPurpose": "机会用户覆盖率、人均机会、机会→请求率",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "UUID；关联后续request"
      },
      {
        "name": "trigger_type",
        "displayName": "触发类型",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "app_foreground/vpn_connected/page_transition/reward_click/timer等"
      },
      {
        "name": "ad_format",
        "displayName": "广告格式",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "app_open/interstitial/rewarded/banner/native"
      },
      {
        "name": "placement",
        "displayName": "广告位",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "稳定英文枚举"
      },
      {
        "name": "eligible",
        "displayName": "是否合资格",
        "dataType": "bool",
        "reportingMode": "每次触发",
        "description": "来自最近一次资格判断"
      },
      {
        "name": "blocked_reason",
        "displayName": "未继续原因",
        "dataType": "str",
        "reportingMode": "被拦截触发",
        "description": "引用05枚举组：blocked_reason；按ad_opportunity所处资格/策略阶段使用"
      }
    ]
  },
  {
    "id": "V17-EVT-020",
    "module": "广告请求",
    "standardEventName": "ad_request",
    "displayName": "真实广告请求",
    "analysisGoal": "只有真正调用AdMob load()时记录，不能把业务方法进入当成请求。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "封装的AdLoader中，调用InterstitialAd.load/RewardedAd.load/AppOpenAd.load/AdView.loadAd之前。",
    "triggerTiming": "每次真实load调用。",
    "metricPurpose": "请求次数/用户、机会→请求率、客户端与AdMob Requests对账",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联机会；无直接机会时也必须生成"
      },
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "UUID；贯穿加载到终态"
      },
      {
        "name": "ad_format",
        "displayName": "广告格式",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "app_open/interstitial/rewarded/banner/native"
      },
      {
        "name": "ad_unit_id",
        "displayName": "广告单元ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "生产广告单元；中台可脱敏显示"
      },
      {
        "name": "placement",
        "displayName": "广告位",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "稳定英文枚举"
      },
      {
        "name": "is_preload",
        "displayName": "是否预加载",
        "dataType": "bool",
        "reportingMode": "每次触发",
        "description": "1=提前加载；0=即时请求"
      },
      {
        "name": "retry_index",
        "displayName": "重试序号",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "首次0；每次重试必须生成新request_id"
      }
    ]
  },
  {
    "id": "V17-EVT-021",
    "module": "广告加载",
    "standardEventName": "ad_load_failed",
    "displayName": "广告加载失败",
    "analysisGoal": "定位no fill、网络、无效请求和内部错误。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "AdMob onAdFailedToLoad回调。",
    "triggerTiming": "每次加载失败。",
    "metricPurpose": "加载失败率、错误码分布、国家/网络问题",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "关联ad_request"
      },
      {
        "name": "load_duration_ms",
        "displayName": "失败耗时",
        "dataType": "int",
        "reportingMode": "失败触发",
        "description": "毫秒"
      },
      {
        "name": "error_domain",
        "displayName": "错误域",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "SDK返回domain"
      },
      {
        "name": "error_code",
        "displayName": "错误码",
        "dataType": "int",
        "reportingMode": "失败触发",
        "description": "SDK原始错误码"
      },
      {
        "name": "error_category",
        "displayName": "错误分类",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "引用05枚举组：error_category"
      },
      {
        "name": "error_message",
        "displayName": "错误摘要",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "脱敏、限长"
      }
    ]
  },
  {
    "id": "V17-EVT-022",
    "module": "广告加载",
    "standardEventName": "ad_load_success",
    "displayName": "广告加载成功",
    "analysisGoal": "AdMob返回可用广告对象，不代表已经展示。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "AdMob onAdLoaded回调。",
    "triggerTiming": "每次加载成功。",
    "metricPurpose": "加载成功率、加载耗时、广告源分布",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "成功触发",
        "description": "关联ad_request"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "成功触发",
        "description": "每个加载成功对象唯一"
      },
      {
        "name": "load_duration_ms",
        "displayName": "加载耗时",
        "dataType": "int",
        "reportingMode": "成功触发",
        "description": "request到onAdLoaded毫秒"
      },
      {
        "name": "response_id",
        "displayName": "AdMob响应ID",
        "dataType": "str",
        "reportingMode": "成功触发",
        "description": "ResponseInfo.responseId，可为空"
      },
      {
        "name": "mediation_adapter",
        "displayName": "中介适配器",
        "dataType": "str",
        "reportingMode": "成功触发",
        "description": "最终加载适配器类名或规范名称"
      },
      {
        "name": "ad_source",
        "displayName": "广告源",
        "dataType": "str",
        "reportingMode": "成功触发",
        "description": "AdMob/竞价网络名称"
      },
      {
        "name": "estimated_expire_at",
        "displayName": "预计过期时间",
        "dataType": "timestamp",
        "reportingMode": "成功触发",
        "description": "由客户端缓存策略计算"
      }
    ]
  },
  {
    "id": "V17-EVT-023",
    "module": "广告加载",
    "standardEventName": "ad_ready",
    "displayName": "广告进入可展示状态",
    "analysisGoal": "确认广告对象已进入缓存并可被业务层消费。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "AdRepository保存onAdLoaded对象并完成状态切换后。",
    "triggerTiming": "每个加载成功对象一次。",
    "metricPurpose": "Ready对象数、缓存覆盖、对象被覆盖率",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联对象"
      },
      {
        "name": "cache_position",
        "displayName": "缓存槽位",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "例如global_interstitial/app_open/home_banner"
      }
    ]
  },
  {
    "id": "V17-EVT-024",
    "module": "广告缓存",
    "standardEventName": "ad_cache_discard",
    "displayName": "缓存丢弃",
    "analysisGoal": "记录加载成功但未被展示的实例终态。",
    "platforms": "Android/iOS",
    "trackingLocation": "替换、策略变化、App销毁或show失败后实际移除时。",
    "triggerTiming": "缓存实例被移除且未正常消费时。",
    "metricPurpose": "缓存浪费率、丢弃原因",
    "sourceAlias": "缓存与双链路规范补充",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "实例原请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "实例ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "丢弃实例"
      },
      {
        "name": "discard_reason",
        "displayName": "丢弃原因",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "expired/replaced/app_destroyed/strategy_changed/show_failed"
      }
    ]
  },
  {
    "id": "V17-EVT-025",
    "module": "广告缓存",
    "standardEventName": "ad_cache_expired",
    "displayName": "缓存过期",
    "analysisGoal": "识别TTL导致的展示损失。",
    "platforms": "Android/iOS",
    "trackingLocation": "缓存检查器实际判定过期并移除时。",
    "triggerTiming": "实例超过有效期时。",
    "metricPurpose": "缓存过期率",
    "sourceAlias": "缓存与双链路规范补充",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "实例原请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "实例ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "过期实例"
      },
      {
        "name": "cache_age_ms",
        "displayName": "缓存年龄",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "整数毫秒"
      }
    ]
  },
  {
    "id": "V17-EVT-026",
    "module": "广告缓存",
    "standardEventName": "ad_cache_hit",
    "displayName": "缓存命中",
    "analysisGoal": "广告机会到来时找到有效缓存。",
    "platforms": "Android/iOS",
    "trackingLocation": "AdCache.takeValidAd完成检查且命中后。",
    "triggerTiming": "每次机会检查缓存命中时。",
    "metricPurpose": "缓存命中率、命中后展示率",
    "sourceAlias": "缓存与双链路规范补充",
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "当前机会"
      },
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "缓存实例原请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "实例ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "命中实例"
      },
      {
        "name": "cache_age_ms",
        "displayName": "缓存年龄",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "加载成功至命中的毫秒数"
      }
    ]
  },
  {
    "id": "V17-EVT-027",
    "module": "广告缓存",
    "standardEventName": "ad_cache_miss",
    "displayName": "缓存未命中",
    "analysisGoal": "解释机会未展示是否因为无有效缓存。",
    "platforms": "Android/iOS",
    "trackingLocation": "AdCache.takeValidAd完成检查且未命中后。",
    "triggerTiming": "每次机会检查缓存未命中时。",
    "metricPurpose": "缓存未命中率、机会无广告率",
    "sourceAlias": "缓存与双链路规范补充",
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "当前机会"
      },
      {
        "name": "miss_reason",
        "displayName": "未命中原因",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "empty/loading/expired/format_mismatch/placement_mismatch"
      }
    ]
  },
  {
    "id": "V17-EVT-028",
    "module": "广告缓存",
    "standardEventName": "ad_cache_put",
    "displayName": "广告放入缓存",
    "analysisGoal": "确认加载成功实例已进入可用缓存。",
    "platforms": "Android/iOS",
    "trackingLocation": "AdCache.put返回成功后。",
    "triggerTiming": "广告实例成功写入缓存时。",
    "metricPurpose": "缓存建立成功率、缓存使用率",
    "sourceAlias": "缓存与双链路规范补充",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "原加载请求ID"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告实例ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "已加载实例ID"
      },
      {
        "name": "cache_scope",
        "displayName": "缓存范围",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "global/placement/page"
      },
      {
        "name": "cache_size_after",
        "displayName": "放入后数量",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "放入后的缓存数量"
      }
    ]
  },
  {
    "id": "V17-EVT-029",
    "module": "广告缓存",
    "standardEventName": "ad_cache_refill",
    "displayName": "触发补缓存",
    "analysisGoal": "记录为什么启动一次缓存补充。",
    "platforms": "Android/iOS",
    "trackingLocation": "AdCacheManager.ensureCache确认需补充后、load前。",
    "triggerTiming": "启动、回前台、消费、过期或丢弃后。",
    "metricPurpose": "补缓存触发次数、触发原因",
    "sourceAlias": "缓存与双链路规范补充",
    "parameters": [
      {
        "name": "refill_reason",
        "displayName": "补缓存原因",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "startup/foreground/consumed/expired/discarded"
      },
      {
        "name": "cache_size_before",
        "displayName": "补充前数量",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "补充前有效缓存数量"
      }
    ]
  },
  {
    "id": "V17-EVT-030",
    "module": "广告缓存",
    "standardEventName": "ad_cache_take",
    "displayName": "取出缓存实例",
    "analysisGoal": "完成机会、请求和实例三类ID绑定。",
    "platforms": "Android/iOS",
    "trackingLocation": "缓存原子take成功后、show前。",
    "triggerTiming": "每次有效缓存被锁定消费时。",
    "metricPurpose": "缓存使用率、实例消费完整率",
    "sourceAlias": "缓存与双链路规范补充",
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "当前机会"
      },
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "实例原请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "实例ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "被取出实例"
      }
    ]
  },
  {
    "id": "V17-EVT-031",
    "module": "广告展示",
    "standardEventName": "ad_click",
    "displayName": "广告点击",
    "analysisGoal": "统计CTR并监控误触或异常点击。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "FullScreenContentCallback.onAdClicked；Banner AdListener.onAdClicked。",
    "triggerTiming": "SDK点击回调。",
    "metricPurpose": "点击数、CTR、异常点击风险",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联对象"
      }
    ]
  },
  {
    "id": "V17-EVT-032",
    "module": "广告展示",
    "standardEventName": "ad_dismissed",
    "displayName": "广告关闭",
    "analysisGoal": "记录全屏广告完整关闭和后续业务恢复。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "FullScreenContentCallback.onAdDismissedFullScreenContent。",
    "triggerTiming": "SDK关闭回调；释放对象并按策略预加载下一条。",
    "metricPurpose": "广告停留时长、关闭率、后续行为",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联对象"
      },
      {
        "name": "show_duration_ms",
        "displayName": "广告显示时长",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "Show Success到Dismiss毫秒"
      }
    ]
  },
  {
    "id": "V17-EVT-033",
    "module": "广告展示",
    "standardEventName": "ad_impression",
    "displayName": "广告产生展示",
    "analysisGoal": "唯一用于计算客户端展示数和广告浏览者的事件。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "FullScreenContentCallback.onAdImpression；Banner使用AdListener.onAdImpression。",
    "triggerTiming": "每次SDK Impression回调。Firebase首期直接按规范上报；中台直传必达阶段才要求本地持久化/ACK。",
    "metricPurpose": "广告浏览者、Impression、人均展示、端到端展示率",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联对象"
      },
      {
        "name": "request_to_impression_ms",
        "displayName": "请求到展示耗时",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "毫秒"
      },
      {
        "name": "show_to_impression_ms",
        "displayName": "Show到展示耗时",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "毫秒"
      },
      {
        "name": "ad_source",
        "displayName": "广告源",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "最终展示广告源"
      },
      {
        "name": "mediation_adapter",
        "displayName": "中介适配器",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "最终适配器"
      }
    ]
  },
  {
    "id": "V17-EVT-034",
    "module": "广告展示",
    "standardEventName": "ad_reward_earned",
    "displayName": "激励奖励获得",
    "analysisGoal": "确认激励视频满足奖励条件，不等同于Paid Event。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "RewardedAd.show的OnUserEarnedRewardListener。",
    "triggerTiming": "用户获得奖励时。",
    "metricPurpose": "奖励完成率、激励漏发/异常",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联请求"
      },
      {
        "name": "reward_type",
        "displayName": "奖励类型",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "产品定义，如free_time/coin"
      },
      {
        "name": "reward_amount",
        "displayName": "奖励数量",
        "dataType": "float",
        "reportingMode": "每次触发",
        "description": "实际发放值"
      }
    ]
  },
  {
    "id": "V17-EVT-035",
    "module": "广告展示",
    "standardEventName": "ad_show_attempt",
    "displayName": "尝试展示广告",
    "analysisGoal": "业务层真正调用show()前记录，用于区分加载成功但未消费。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "统一AdPresenter中，调用ad.show(activity)之前。",
    "triggerTiming": "每次show调用前；先校验Activity、前台、频控和全屏互斥。",
    "metricPurpose": "展示触发率、Load→Show耗时、广告对象消费率",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联对象"
      },
      {
        "name": "loaded_to_show_ms",
        "displayName": "加载到Show耗时",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "onAdLoaded到show调用毫秒"
      },
      {
        "name": "activity_state",
        "displayName": "Activity状态",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "resumed/paused/destroyed/unknown"
      },
      {
        "name": "app_state",
        "displayName": "App状态",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "foreground/background"
      },
      {
        "name": "trigger_type",
        "displayName": "展示触发类型",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "继承机会触发类型"
      }
    ]
  },
  {
    "id": "V17-EVT-036",
    "module": "广告展示",
    "standardEventName": "ad_show_blocked",
    "displayName": "广告展示被阻止",
    "analysisGoal": "仅用于：广告已完成真实load且已有request_id、ad_instance_id，已进入准备展示阶段，但在调用展示API前被阻止。资格不通过、频控/会员/consent/配置关闭等load前拦截不使用本事件。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "统一AdPresenter/展示协调层：已绑定request与广告实例后、调用平台展示API前的最终校验分支；包括页面已离开、App后台/无可用展示上下文、广告过期、全屏互斥、实例被取消等。",
    "triggerTiming": "仅当已有request_id和ad_instance_id，且确定该广告实例不会进入show时触发；一个广告实例只记录一个未展示终态。",
    "metricPurpose": "未展示请求归因、user_left_page率、app_background率、过期率",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "阻止触发",
        "description": "必填；来自已完成load的原始请求，禁止临时补造"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "阻止触发",
        "description": "必填；来自load_success后的广告对象，禁止临时补造"
      },
      {
        "name": "blocked_reason",
        "displayName": "阻止原因",
        "dataType": "str",
        "reportingMode": "阻止触发",
        "description": "引用05枚举组：blocked_reason；仅使用标注为ad_show_blocked（已加载后展示前）适用的值"
      },
      {
        "name": "from_screen",
        "displayName": "来源页面",
        "dataType": "str",
        "reportingMode": "阻止触发",
        "description": "广告触发页面"
      },
      {
        "name": "to_screen",
        "displayName": "目标页面",
        "dataType": "str",
        "reportingMode": "user_left_page触发",
        "description": "App内跳转目标；后台可为空"
      },
      {
        "name": "loaded_to_block_ms",
        "displayName": "加载到阻止耗时",
        "dataType": "int",
        "reportingMode": "阻止触发",
        "description": "毫秒"
      },
      {
        "name": "app_state",
        "displayName": "App状态",
        "dataType": "str",
        "reportingMode": "阻止触发",
        "description": "foreground/background"
      }
    ]
  },
  {
    "id": "V17-EVT-037",
    "module": "广告展示",
    "standardEventName": "ad_show_failed",
    "displayName": "广告展示失败",
    "analysisGoal": "调用show后SDK拒绝或失败。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "FullScreenContentCallback.onAdFailedToShowFullScreenContent。",
    "triggerTiming": "SDK回调时，记录终态并释放对象。",
    "metricPurpose": "Show失败率、错误码分布",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "关联对象"
      },
      {
        "name": "error_domain",
        "displayName": "错误域",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "SDK返回domain"
      },
      {
        "name": "error_code",
        "displayName": "错误码",
        "dataType": "int",
        "reportingMode": "失败触发",
        "description": "SDK原始错误码"
      },
      {
        "name": "error_message",
        "displayName": "错误摘要",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "脱敏、限长"
      }
    ]
  },
  {
    "id": "V17-EVT-038",
    "module": "广告展示",
    "standardEventName": "ad_show_success",
    "displayName": "广告开始展示",
    "analysisGoal": "全屏广告已经显示，不等于已产生Impression。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "FullScreenContentCallback.onAdShowedFullScreenContent。",
    "triggerTiming": "SDK回调时。",
    "metricPurpose": "Show成功率、Show失败排查",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "成功触发",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "成功触发",
        "description": "关联对象"
      }
    ]
  },
  {
    "id": "V17-EVT-039",
    "module": "广告收入",
    "standardEventName": "ad_paid_event",
    "displayName": "广告价值回传",
    "analysisGoal": "记录Impression级收入，用于客户端收入、eCPM和ARPDAU分析。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "OnPaidEventListener；广告对象创建后立即绑定。",
    "triggerTiming": "SDK Paid Event回调并高优先级上报。Firebase首期不要求本地必达队列；中台直传必达阶段再启用持久化/ACK。",
    "metricPurpose": "广告收入、eCPM、ARPDAU、国家/广告位收入",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "关联对象"
      },
      {
        "name": "value_micros",
        "displayName": "收入微单位",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "实际货币值×1,000,000"
      },
      {
        "name": "currency_code",
        "displayName": "币种",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "ISO 4217，例如USD"
      },
      {
        "name": "precision_type",
        "displayName": "精度类型",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "unknown/estimated/publisher_provided/precise"
      },
      {
        "name": "ad_source",
        "displayName": "广告源",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "最终收入来源"
      },
      {
        "name": "mediation_adapter",
        "displayName": "中介适配器",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "最终适配器"
      }
    ]
  },
  {
    "id": "V17-EVT-040",
    "module": "Banner专项",
    "standardEventName": "banner_visible",
    "displayName": "Banner实际可见",
    "analysisGoal": "识别Banner已加载但被遮挡、未挂载或离开可视区域。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "AdView挂载后结合View可见性、窗口焦点和可视区域监听。",
    "triggerTiming": "可见状态变化；避免高频抖动，建议状态切换触发。",
    "metricPurpose": "Banner可见率、加载未展示原因、有效曝光时长",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "状态变化触发",
        "description": "关联Banner请求"
      },
      {
        "name": "is_visible",
        "displayName": "是否实际可见",
        "dataType": "bool",
        "reportingMode": "状态变化触发",
        "description": "可见且未被遮挡的业务判断"
      },
      {
        "name": "visibility_reason",
        "displayName": "不可见原因",
        "dataType": "str",
        "reportingMode": "is_visible=false",
        "description": "detached/covered/offscreen/page_hidden/app_background/size_zero/unknown"
      },
      {
        "name": "visible_duration_ms",
        "displayName": "本次可见时长",
        "dataType": "int",
        "reportingMode": "变为不可见触发",
        "description": "毫秒"
      }
    ]
  },
  {
    "id": "V17-EVT-041",
    "module": "接口质量",
    "standardEventName": "api_request_result",
    "displayName": "接口请求结果",
    "analysisGoal": "统一业务接口成功、失败、耗时和错误阶段，不再使用api_error/api_success复合事件名。",
    "platforms": "Android/iOS",
    "trackingLocation": "统一HTTP拦截器在响应、异常或超时终态处。",
    "triggerTiming": "每次业务接口请求结束时，仅上报一次终态。",
    "metricPurpose": "接口成功率、错误码、国家/版本网络异常、接口耗时",
    "sourceAlias": "api_error/api_success",
    "parameters": [
      {
        "name": "api_name",
        "displayName": "接口名称",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "稳定接口枚举，不直接用包含参数的完整URL"
      },
      {
        "name": "api_path",
        "displayName": "接口路径",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "去除域名和敏感查询参数后的模板路径"
      },
      {
        "name": "success",
        "displayName": "是否成功",
        "dataType": "bool",
        "reportingMode": "每次触发",
        "description": "true/false"
      },
      {
        "name": "http_code",
        "displayName": "HTTP状态码",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "无响应时为0"
      },
      {
        "name": "duration_ms",
        "displayName": "接口耗时",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "请求开始到终态的毫秒数"
      },
      {
        "name": "error_stage",
        "displayName": "失败阶段",
        "dataType": "str",
        "reportingMode": "失败时触发",
        "description": "dns/connect/tls/timeout/http/business/parse"
      },
      {
        "name": "error_code",
        "displayName": "错误码",
        "dataType": "str",
        "reportingMode": "失败时触发",
        "description": "客户端或服务端标准错误码"
      },
      {
        "name": "error_message",
        "displayName": "错误摘要",
        "dataType": "str",
        "reportingMode": "失败时触发",
        "description": "脱敏并限制长度"
      },
      {
        "name": "request_parameter_summary",
        "displayName": "入参摘要",
        "dataType": "str",
        "reportingMode": "按需触发",
        "description": "仅字段名或脱敏摘要，不上报Token/密码"
      }
    ]
  },
  {
    "id": "V17-EVT-042",
    "module": "上报健康",
    "standardEventName": "telemetry_backend_ack",
    "displayName": "中台ACK结果",
    "analysisGoal": "区分HTTP成功和服务端真实接收。",
    "platforms": "Android/iOS",
    "trackingLocation": "BackendUploader解析服务端ACK后。",
    "triggerTiming": "每次批次收到有效ACK时。",
    "metricPurpose": "ACK成功率、最终送达率",
    "sourceAlias": "缓存与双链路规范补充",
    "parameters": [
      {
        "name": "batch_id",
        "displayName": "批次ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "本次上传批次"
      },
      {
        "name": "accepted_count",
        "displayName": "接收数量",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "服务端accepted数量"
      },
      {
        "name": "rejected_count",
        "displayName": "拒绝数量",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "服务端rejected数量"
      },
      {
        "name": "ack_duration_ms",
        "displayName": "ACK耗时",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "发送到收到ACK的毫秒数"
      }
    ]
  },
  {
    "id": "V17-EVT-043",
    "module": "上报健康",
    "standardEventName": "telemetry_batch_failed",
    "displayName": "中台批次失败",
    "analysisGoal": "定位DNS、超时、SSL、4xx、5xx等导致中台DAU偏低的问题。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Telemetry SDK网络异常或服务端非成功响应回调。",
    "triggerTiming": "每次发送失败；进入本地重试队列。",
    "metricPurpose": "上报失败率、错误分布、版本/国家/网络异常",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "batch_id",
        "displayName": "批次ID",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "关联发送批次"
      },
      {
        "name": "error_type",
        "displayName": "失败类型",
        "dataType": "str",
        "reportingMode": "失败触发",
        "description": "dns_failed/connect_timeout/read_timeout/ssl_error/http_4xx/http_5xx/network_unavailable/invalid_response/unknown"
      },
      {
        "name": "http_status",
        "displayName": "HTTP状态",
        "dataType": "int",
        "reportingMode": "失败触发",
        "description": "无响应填0"
      },
      {
        "name": "request_duration_ms",
        "displayName": "失败耗时",
        "dataType": "int",
        "reportingMode": "失败触发",
        "description": "毫秒"
      },
      {
        "name": "queue_size",
        "displayName": "当前队列长度",
        "dataType": "int",
        "reportingMode": "失败触发",
        "description": "失败后待重试事件数"
      },
      {
        "name": "oldest_event_age_ms",
        "displayName": "最老事件年龄",
        "dataType": "int",
        "reportingMode": "失败触发",
        "description": "毫秒"
      }
    ]
  },
  {
    "id": "V17-EVT-044",
    "module": "上报健康",
    "standardEventName": "telemetry_batch_send",
    "displayName": "中台批次发送",
    "analysisGoal": "监测客户端是否真实尝试向中台发送事件。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Telemetry SDK网络发送器；请求发出前。",
    "triggerTiming": "每个批次发送前；健康摘要可同时发Firebase。",
    "metricPurpose": "发送批次、事件发送量、积压程度、重试分布",
    "sourceAlias": "原完整变现规范",
    "parameters": [
      {
        "name": "batch_id",
        "displayName": "批次ID",
        "dataType": "str",
        "reportingMode": "每次触发",
        "description": "一次HTTP批次唯一ID"
      },
      {
        "name": "event_count",
        "displayName": "批次事件数",
        "dataType": "int",
        "reportingMode": "每次触发",
        "description": "本批次事件条数"
      }
    ]
  }
];

export const v17EventModules = ["App生命周期","页面行为","核心行为","VPN业务","付费业务","隐私与SDK","广告机会","广告请求","广告加载","广告缓存","广告展示","广告收入","Banner专项","接口质量","上报健康"];
