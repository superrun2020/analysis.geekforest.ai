export type V18EventParameter = {
  "name": string,
  "displayName": string,
  "dataType": string,
  "reportingMode": string,
  "description": string
};

export type V18StandardEvent = {
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
  priority: "P0" | "P1" | "P2";
  chainKey: "session_id" | "vpn_session_id";
  sourceSheets: string[];
  parameters: V18EventParameter[];
};

export const v18EventSource = {
  "workbook": "JKCL跨团队埋点规范_V1.8_广告与VPN拆分版_明文IP_资格检查更新.xlsx",
  "sheets": [
    "01A_广告变现打点",
    "01B_VPN功能打点"
  ],
  "extractedEventCount": 62,
  "parameterRowCount": 376,
  "advertisingChainKey": "session_id",
  "vpnChainKey": "vpn_session_id"
} as const;

export const v18StandardEvents: V18StandardEvent[] = [
  {
    "id": "V18-EVT-001",
    "module": "付费业务",
    "standardEventName": "purchase_result",
    "displayName": "支付结果",
    "analysisGoal": "统一VPN支付、订阅页支付和其他产品付款结果。",
    "platforms": "Android/iOS",
    "trackingLocation": "BillingClient/StoreKit/Web支付回调的最终状态处理层。",
    "triggerTiming": "订单成功、失败、取消或超时形成最终状态时。Firebase首期正常logEvent；进入中台直传必达阶段后再要求本地持久化至服务端ACK。",
    "metricPurpose": "支付成功率、收入、商品转化、国家/渠道支付异常",
    "sourceAlias": "vpn_payment、iwxcleaner_pay_results",
    "priority": "P1",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "order_id",
        "displayName": "订单ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；订单唯一ID，用于幂等去重"
      },
      {
        "name": "product_id",
        "displayName": "商品ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；商店或本地商品ID"
      },
      {
        "name": "payment_channel",
        "displayName": "支付渠道",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；iap_one_time/iap_subscription/local/web"
      },
      {
        "name": "payment_platform",
        "displayName": "支付平台",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；android/ios/web/web_from_android/web_from_ios"
      },
      {
        "name": "purchase_country",
        "displayName": "支付国家",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；ISO 3166-1 alpha-2"
      },
      {
        "name": "result_status",
        "displayName": "支付状态",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；success/failed/cancelled/timeout/pending"
      },
      {
        "name": "amount",
        "displayName": "支付金额",
        "dataType": "decimal",
        "reportingMode": "P2｜金额可用时",
        "description": "可选；纯数字，不含货币符号"
      },
      {
        "name": "currency",
        "displayName": "货币代码",
        "dataType": "str",
        "reportingMode": "P2｜金额可用时",
        "description": "可选；ISO 4217，如USD"
      },
      {
        "name": "scene",
        "displayName": "触发场景",
        "dataType": "str",
        "reportingMode": "P2｜按需触发",
        "description": "可选；订阅页或功能场景枚举"
      }
    ]
  },
  {
    "id": "V18-EVT-002",
    "module": "付费业务",
    "standardEventName": "subscription_status_changed",
    "displayName": "订阅状态变化",
    "analysisGoal": "解释会话中广告资格因购买、续费、宽限期或过期发生的变化。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Billing/StoreKit/订阅权益Provider状态变化回调。",
    "triggerTiming": "old_status与new_status真实不同且权益已应用时。",
    "metricPurpose": "权益变更量、订阅后广告误展示率、续费/过期用户变化",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "old_status",
        "displayName": "原订阅状态",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；none/trial/active/grace/expired"
      },
      {
        "name": "new_status",
        "displayName": "新订阅状态",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；none/trial/active/grace/expired"
      },
      {
        "name": "change_reason",
        "displayName": "变化原因",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；purchase/renewal/expiry/refund/grace/server_sync/unknown"
      },
      {
        "name": "product_id",
        "displayName": "商品ID",
        "dataType": "str",
        "reportingMode": "P2｜可得时",
        "description": "可选；商店稳定商品ID"
      }
    ]
  },
  {
    "id": "V18-EVT-003",
    "module": "广告缓存",
    "standardEventName": "ad_cache_expired",
    "displayName": "缓存过期",
    "analysisGoal": "识别TTL导致的展示损失。",
    "platforms": "Android/iOS",
    "trackingLocation": "缓存检查器实际判定过期并移除时。",
    "triggerTiming": "每次过期。",
    "metricPurpose": "缓存过期率",
    "sourceAlias": "缓存与双链路规范补充",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；实例原请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "实例ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；过期实例"
      }
    ]
  },
  {
    "id": "V18-EVT-004",
    "module": "广告缓存",
    "standardEventName": "ad_cache_hit",
    "displayName": "缓存命中",
    "analysisGoal": "广告机会到来时找到有效缓存。",
    "platforms": "Android/iOS",
    "trackingLocation": "AdCache.takeValidAd完成检查且命中后。",
    "triggerTiming": "每次机会检查缓存命中时。",
    "metricPurpose": "缓存命中率、命中后展示率",
    "sourceAlias": "缓存与双链路规范补充",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；当前机会"
      },
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；缓存实例原请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "实例ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；命中实例"
      }
    ]
  },
  {
    "id": "V18-EVT-005",
    "module": "广告缓存",
    "standardEventName": "ad_cache_miss",
    "displayName": "缓存未命中",
    "analysisGoal": "解释机会未展示是否因为无有效缓存。",
    "platforms": "Android/iOS",
    "trackingLocation": "AdCache.takeValidAd完成检查且未命中后。",
    "triggerTiming": "每次机会检查缓存未命中时。",
    "metricPurpose": "缓存未命中率、机会无广告率",
    "sourceAlias": "缓存与双链路规范补充",
    "priority": "P1",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；当前机会"
      },
      {
        "name": "miss_reason",
        "displayName": "未命中原因",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；empty/loading/expired/format_mismatch/placement_mismatch"
      }
    ]
  },
  {
    "id": "V18-EVT-006",
    "module": "广告缓存",
    "standardEventName": "ad_cache_put",
    "displayName": "广告放入缓存",
    "analysisGoal": "确认加载成功实例已进入可用缓存。",
    "platforms": "Android/iOS",
    "trackingLocation": "AdCache.put返回成功后。",
    "triggerTiming": "缓存由空变为可用时触发；同一广告位不得同时维护多个有效广告对象。",
    "metricPurpose": "缓存建立成功率、缓存使用率",
    "sourceAlias": "缓存与双链路规范补充",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；原加载请求ID"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告实例ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；已加载实例ID"
      },
      {
        "name": "ttl_ms",
        "displayName": "缓存TTL",
        "dataType": "int",
        "reportingMode": "P2｜TTL动态配置时",
        "description": "可选；本次广告对象有效期毫秒；固定TTL由配置维表维护，不要求每次事件重复上传"
      }
    ]
  },
  {
    "id": "V18-EVT-007",
    "module": "广告缓存",
    "standardEventName": "ad_cache_take",
    "displayName": "取出缓存实例",
    "analysisGoal": "完成机会、请求和实例三类ID绑定。",
    "platforms": "Android/iOS",
    "trackingLocation": "缓存原子take成功后、show前。",
    "triggerTiming": "每次有效缓存被锁定消费时。",
    "metricPurpose": "缓存使用率、实例消费完整率",
    "sourceAlias": "缓存与双链路规范补充",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；当前机会"
      },
      {
        "name": "request_id",
        "displayName": "请求ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；实例原请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "实例ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；被取出实例"
      }
    ]
  },
  {
    "id": "V18-EVT-008",
    "module": "广告机会",
    "standardEventName": "ad_opportunity",
    "displayName": "广告机会产生",
    "analysisGoal": "只记录资格通过后的真实广告机会，并与资格决策精确关联。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "ad_eligibility_check返回eligible=1后立即生成opportunity_id；随后再检查缓存或发起实时请求。",
    "triggerTiming": "每次资格通过后一次；eligible=0以及Splash/补缓存预拉均不上报。",
    "metricPurpose": "合资格机会数、通过后机会完整率、机会→缓存命中/请求/展示转化",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；资格通过后新生成UUID；贯穿缓存检查、展示和必要的实时请求"
      },
      {
        "name": "trigger_type",
        "displayName": "场景触发类型",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；app_foreground/vpn_connected/page_transition/reward_click/timer/other"
      },
      {
        "name": "ad_format",
        "displayName": "广告格式",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；app_open/interstitial/rewarded/banner/native"
      },
      {
        "name": "placement",
        "displayName": "广告位",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；稳定英文枚举；与资格事件一致"
      },
      {
        "name": "decision_id",
        "displayName": "资格决策ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联ad_eligibility_check"
      }
    ]
  },
  {
    "id": "V18-EVT-009",
    "module": "广告加载",
    "standardEventName": "ad_load_failed",
    "displayName": "广告加载失败",
    "analysisGoal": "定位no fill、网络、无效请求和内部错误。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "AdMob onAdFailedToLoad回调。",
    "triggerTiming": "每次加载失败。",
    "metricPurpose": "加载失败率、错误码分布、国家/网络问题",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜失败触发",
        "description": "条件必传；关联ad_request"
      },
      {
        "name": "load_duration_ms",
        "displayName": "失败耗时",
        "dataType": "int",
        "reportingMode": "P2｜失败触发",
        "description": "可选；毫秒"
      },
      {
        "name": "error_domain",
        "displayName": "错误域",
        "dataType": "str",
        "reportingMode": "P0｜失败触发",
        "description": "条件必传；SDK返回domain"
      },
      {
        "name": "error_code",
        "displayName": "错误码",
        "dataType": "int",
        "reportingMode": "P0｜失败触发",
        "description": "条件必传；SDK原始错误码"
      },
      {
        "name": "error_category",
        "displayName": "错误分类",
        "dataType": "str",
        "reportingMode": "P2｜失败触发",
        "description": "可选；引用05枚举组：error_category"
      }
    ]
  },
  {
    "id": "V18-EVT-010",
    "module": "广告加载",
    "standardEventName": "ad_load_success",
    "displayName": "广告加载成功",
    "analysisGoal": "AdMob返回可用广告对象，不代表已经展示。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "AdMob onAdLoaded回调。",
    "triggerTiming": "每次加载成功。",
    "metricPurpose": "加载成功率、加载耗时、广告源分布",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜成功触发",
        "description": "条件必传；关联ad_request"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "P0｜成功触发",
        "description": "条件必传；每个加载成功对象唯一"
      },
      {
        "name": "load_duration_ms",
        "displayName": "加载耗时",
        "dataType": "int",
        "reportingMode": "P2｜成功触发",
        "description": "可选；request到onAdLoaded毫秒"
      },
      {
        "name": "response_id",
        "displayName": "AdMob响应ID",
        "dataType": "str",
        "reportingMode": "P1｜成功触发",
        "description": "条件必传；ResponseInfo.responseId，可为空"
      },
      {
        "name": "mediation_adapter",
        "displayName": "中介适配器",
        "dataType": "str",
        "reportingMode": "P1｜成功触发",
        "description": "条件必传；最终加载适配器类名或规范名称"
      },
      {
        "name": "ad_source",
        "displayName": "广告源",
        "dataType": "str",
        "reportingMode": "P1｜成功触发",
        "description": "条件必传；AdMob/竞价网络名称"
      }
    ]
  },
  {
    "id": "V18-EVT-011",
    "module": "广告请求",
    "standardEventName": "ad_request",
    "displayName": "真实广告请求",
    "analysisGoal": "记录每一次实际调用AdMob load的请求，不以加载成功或失败作为是否上报的条件。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "统一AdLoader完成并发/缓存/参数校验，生成request_id后，在实际调用AdMob load()紧前一行。",
    "triggerTiming": "每次真实调用load()都上报；请求随后成功、失败、超时或同步抛错均不撤销。仅计划请求但最终未调用load()不上报。",
    "metricPurpose": "真实SDK请求量、请求终态完整率、预拉/实时请求成功率、after IP关联率",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "opportunity_id",
        "displayName": "广告机会ID",
        "dataType": "str",
        "reportingMode": "P1｜业务场景实时请求时",
        "description": "条件必传；on_demand请求关联资格通过后生成的机会；Splash预拉和补缓存预拉省略"
      },
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；UUID；贯穿加载到终态"
      },
      {
        "name": "ad_format",
        "displayName": "广告格式",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；app_open/interstitial/rewarded/banner/native"
      },
      {
        "name": "ad_unit_id",
        "displayName": "广告单元ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；生产广告单元；中台可脱敏显示"
      },
      {
        "name": "placement",
        "displayName": "广告位",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；稳定英文枚举"
      },
      {
        "name": "retry_index",
        "displayName": "重试序号",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；首次0；每次重试必须生成新request_id"
      },
      {
        "name": "request_type",
        "displayName": "请求类型",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；splash_preload/cache_refill/on_demand；重试仍保持原类型并通过retry_index区分"
      },
      {
        "name": "decision_id",
        "displayName": "资格决策ID",
        "dataType": "str",
        "reportingMode": "P1｜业务场景实时请求时",
        "description": "条件必传；on_demand请求关联ad_eligibility_check；Splash预拉和补缓存预拉省略"
      },
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜VPN已连接时",
        "description": "条件必传；绑定连接/IP/广告请求"
      },
      {
        "name": "ip_after_status",
        "displayName": "连接后IP状态",
        "dataType": "str",
        "reportingMode": "P0｜VPN已连接时",
        "description": "条件必传；success/failed/timeout/not_started/unknown；完整IP不传Firebase"
      },
      {
        "name": "refill_reason",
        "displayName": "补缓存原因",
        "dataType": "str",
        "reportingMode": "P1｜request_type=cache_refill时",
        "description": "条件必传；startup/foreground/consumed/expired/invalidated/unknown；替代独立ad_cache_refill事件"
      }
    ]
  },
  {
    "id": "V18-EVT-012",
    "module": "广告收入",
    "standardEventName": "ad_paid_event",
    "displayName": "广告价值回传",
    "analysisGoal": "记录Impression级收入，用于客户端收入、eCPM和ARPDAU分析。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "OnPaidEventListener；广告对象创建后立即绑定。",
    "triggerTiming": "SDK Paid Event回调并高优先级上报。Firebase首期不要求本地必达队列；中台直传必达阶段再启用持久化/ACK。",
    "metricPurpose": "广告收入、eCPM、ARPDAU、国家/广告位收入",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联对象"
      },
      {
        "name": "value_micros",
        "displayName": "收入微单位",
        "dataType": "int",
        "reportingMode": "P0｜每次触发",
        "description": "必传；实际货币值×1,000,000"
      },
      {
        "name": "currency_code",
        "displayName": "币种",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；ISO 4217，例如USD"
      },
      {
        "name": "precision_type",
        "displayName": "精度类型",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；unknown/estimated/publisher_provided/precise"
      },
      {
        "name": "ad_source",
        "displayName": "广告源",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；最终收入来源"
      },
      {
        "name": "mediation_adapter",
        "displayName": "中介适配器",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；最终适配器"
      }
    ]
  },
  {
    "id": "V18-EVT-013",
    "module": "广告展示",
    "standardEventName": "ad_click",
    "displayName": "广告点击",
    "analysisGoal": "统计CTR并监控误触或异常点击。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "FullScreenContentCallback.onAdClicked；Banner AdListener.onAdClicked。",
    "triggerTiming": "SDK点击回调。",
    "metricPurpose": "点击数、CTR、异常点击风险",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联对象"
      }
    ]
  },
  {
    "id": "V18-EVT-014",
    "module": "广告展示",
    "standardEventName": "ad_dismissed",
    "displayName": "广告关闭",
    "analysisGoal": "记录全屏广告完整关闭和后续业务恢复。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "FullScreenContentCallback.onAdDismissedFullScreenContent。",
    "triggerTiming": "SDK关闭回调；释放对象并按策略预加载下一条。",
    "metricPurpose": "广告停留时长、关闭率、后续行为",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联对象"
      }
    ]
  },
  {
    "id": "V18-EVT-015",
    "module": "广告展示",
    "standardEventName": "ad_impression",
    "displayName": "广告产生展示",
    "analysisGoal": "唯一用于计算客户端展示数和广告浏览者的事件。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "FullScreenContentCallback.onAdImpression；Banner使用AdListener.onAdImpression。",
    "triggerTiming": "每次SDK Impression回调。Firebase首期直接按规范上报；中台直传必达阶段才要求本地持久化/ACK。",
    "metricPurpose": "广告浏览者、Impression、人均展示、端到端展示率",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联对象"
      },
      {
        "name": "ad_source",
        "displayName": "广告源",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；最终展示广告源"
      },
      {
        "name": "mediation_adapter",
        "displayName": "中介适配器",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；最终适配器"
      }
    ]
  },
  {
    "id": "V18-EVT-016",
    "module": "广告展示",
    "standardEventName": "ad_reward_earned",
    "displayName": "激励奖励获得",
    "analysisGoal": "确认激励视频满足奖励条件，不等同于Paid Event。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "RewardedAd.show的OnUserEarnedRewardListener。",
    "triggerTiming": "用户获得奖励时。",
    "metricPurpose": "奖励完成率、激励漏发/异常",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联请求"
      },
      {
        "name": "reward_type",
        "displayName": "奖励类型",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；产品定义，如free_time/coin"
      },
      {
        "name": "reward_amount",
        "displayName": "奖励数量",
        "dataType": "float",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；实际发放值"
      }
    ]
  },
  {
    "id": "V18-EVT-017",
    "module": "广告展示",
    "standardEventName": "ad_show_attempt",
    "displayName": "尝试展示广告",
    "analysisGoal": "业务层真正调用show()前记录，用于区分加载成功但未消费。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "统一AdPresenter中，调用ad.show(activity)之前。",
    "triggerTiming": "每次show调用前；先校验Activity、前台、频控和全屏互斥。",
    "metricPurpose": "展示触发率、Load→Show耗时、广告对象消费率",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联对象"
      },
      {
        "name": "activity_state",
        "displayName": "Activity状态",
        "dataType": "str",
        "reportingMode": "P2｜每次触发",
        "description": "可选；resumed/paused/destroyed/unknown"
      },
      {
        "name": "app_state",
        "displayName": "App状态",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；foreground/background"
      },
      {
        "name": "trigger_type",
        "displayName": "展示触发类型",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；继承机会触发类型"
      }
    ]
  },
  {
    "id": "V18-EVT-018",
    "module": "广告展示",
    "standardEventName": "ad_show_blocked",
    "displayName": "广告展示被阻止",
    "analysisGoal": "仅用于：广告已完成真实load且已有request_id、ad_instance_id，已进入准备展示阶段，但在调用展示API前被阻止。资格不通过、频控/会员/consent/配置关闭等load前拦截不使用本事件。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "统一AdPresenter/展示协调层：已绑定request与广告实例后、调用平台展示API前的最终校验分支；包括页面已离开、App后台/无可用展示上下文、广告过期、全屏互斥、实例被取消等。",
    "triggerTiming": "仅当已有request_id和ad_instance_id，且确定该广告实例不会进入show时触发；一个广告实例只记录一个未展示终态。",
    "metricPurpose": "未展示请求归因、user_left_page率、app_background率、过期率",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜阻止触发",
        "description": "条件必传；必填；来自已完成load的原始请求，禁止临时补造"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "P0｜阻止触发",
        "description": "条件必传；必填；来自load_success后的广告对象，禁止临时补造"
      },
      {
        "name": "blocked_reason",
        "displayName": "阻止原因",
        "dataType": "str",
        "reportingMode": "P1｜阻止触发",
        "description": "条件必传；引用05枚举组：blocked_reason；仅使用标注为ad_show_blocked（已加载后展示前）适用的值"
      },
      {
        "name": "from_screen",
        "displayName": "来源页面",
        "dataType": "str",
        "reportingMode": "P2｜阻止触发",
        "description": "可选；广告触发页面"
      },
      {
        "name": "to_screen",
        "displayName": "目标页面",
        "dataType": "str",
        "reportingMode": "P2｜user_left_page触发",
        "description": "可选；App内跳转目标；后台可为空"
      },
      {
        "name": "loaded_to_block_ms",
        "displayName": "加载到阻止耗时",
        "dataType": "int",
        "reportingMode": "P2｜阻止触发",
        "description": "可选；毫秒"
      },
      {
        "name": "app_state",
        "displayName": "App状态",
        "dataType": "str",
        "reportingMode": "P2｜阻止触发",
        "description": "可选；foreground/background"
      }
    ]
  },
  {
    "id": "V18-EVT-019",
    "module": "广告展示",
    "standardEventName": "ad_show_failed",
    "displayName": "广告展示失败",
    "analysisGoal": "调用show后SDK拒绝或失败。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "FullScreenContentCallback.onAdFailedToShowFullScreenContent。",
    "triggerTiming": "SDK回调时，记录终态并释放对象。",
    "metricPurpose": "Show失败率、错误码分布",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜失败触发",
        "description": "条件必传；关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "P0｜失败触发",
        "description": "条件必传；关联对象"
      },
      {
        "name": "error_domain",
        "displayName": "错误域",
        "dataType": "str",
        "reportingMode": "P0｜失败触发",
        "description": "条件必传；SDK返回domain"
      },
      {
        "name": "error_code",
        "displayName": "错误码",
        "dataType": "int",
        "reportingMode": "P0｜失败触发",
        "description": "条件必传；SDK原始错误码"
      }
    ]
  },
  {
    "id": "V18-EVT-020",
    "module": "广告展示",
    "standardEventName": "ad_show_success",
    "displayName": "广告开始展示",
    "analysisGoal": "全屏广告已经显示，不等于已产生Impression。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "FullScreenContentCallback.onAdShowedFullScreenContent。",
    "triggerTiming": "SDK回调时。",
    "metricPurpose": "Show成功率、Show失败排查",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜成功触发",
        "description": "条件必传；关联请求"
      },
      {
        "name": "ad_instance_id",
        "displayName": "广告对象ID",
        "dataType": "str",
        "reportingMode": "P0｜成功触发",
        "description": "条件必传；关联对象"
      }
    ]
  },
  {
    "id": "V18-EVT-021",
    "module": "广告资格",
    "standardEventName": "ad_eligibility_check",
    "displayName": "广告资格判断",
    "analysisGoal": "记录真实业务场景到达后的资格结果；热启动和点击VPN连接按钮纳入资格漏斗；预加载和补缓存不参与资格漏斗。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "真实业务场景到达后，在生成opportunity_id和检查缓存之前调用AdPolicy/AdEligibilityManager；热启动开屏、点击VPN连接按钮时也触发资格检查。",
    "triggerTiming": "每次真实业务场景到达一次；新增热启动、点击VPN连接按钮两个资格触发时机；Splash预拉、启动预拉、回前台补缓存预拉和补缓存预拉均不上报。",
    "metricPurpose": "业务场景资格通过率、资格拦截原因分布、通过后机会完整率；可区分未点击VPN连接按钮、已点击但未获取VPN权限两类前置拦截。",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "eligible",
        "displayName": "是否合资格",
        "dataType": "bool",
        "reportingMode": "P0｜每次触发",
        "description": "必传；1=通过并继续生成广告机会；0=不生成机会并结束本次场景广告链路"
      },
      {
        "name": "blocked_reason",
        "displayName": "资格拦截原因",
        "dataType": "str",
        "reportingMode": "P0｜eligible=0时",
        "description": "条件必传；引用05枚举组：blocked_reason；资格阶段常用 subscription_user/remote_config_disabled/frequency_cap/sdk_not_initialized/no_network/vpn_connect_not_clicked/vpn_permission_not_granted/consent_not_ready/unknown"
      },
      {
        "name": "ad_format",
        "displayName": "广告格式",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；app_open/interstitial/rewarded/banner/native"
      },
      {
        "name": "placement",
        "displayName": "广告位",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；产品定义的稳定广告位英文名"
      },
      {
        "name": "decision_id",
        "displayName": "资格决策ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；每次资格判断UUID"
      },
      {
        "name": "policy_version",
        "displayName": "广告策略版本",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；远程配置/策略版本"
      },
      {
        "name": "frequency_current",
        "displayName": "当前频控次数",
        "dataType": "int",
        "reportingMode": "P1｜频控适用时",
        "description": "条件必传；当前窗口已展示/触发次数"
      },
      {
        "name": "frequency_limit",
        "displayName": "频控上限",
        "dataType": "int",
        "reportingMode": "P1｜频控适用时",
        "description": "条件必传；当前窗口上限"
      }
    ]
  },
  {
    "id": "V18-EVT-022",
    "module": "归因",
    "standardEventName": "attribution_result",
    "displayName": "归因结果",
    "analysisGoal": "支持渠道、Campaign、广告组和素材层级的用户质量及VPN变现分析。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "AppsFlyer/Adjust/Firebase等归因SDK最终回调或延迟归因更新。",
    "triggerTiming": "首次有效归因及真实归因变化时；同值不重复。",
    "metricPurpose": "归因成功率、渠道VPN连接率、素材广告浏览者比例与ARPDAU",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "attribution_status",
        "displayName": "归因状态",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；organic/attributed/failed/timeout/unknown"
      },
      {
        "name": "attribution_provider",
        "displayName": "归因平台",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；adjust/appsflyer/firebase/other"
      },
      {
        "name": "media_source",
        "displayName": "媒体来源",
        "dataType": "str",
        "reportingMode": "P1｜归因可得时",
        "description": "可选；归因SDK稳定值；高基数仅BQ/ADB"
      },
      {
        "name": "campaign_id",
        "displayName": "Campaign ID",
        "dataType": "str",
        "reportingMode": "P1｜归因可得时",
        "description": "可选；稳定ID，不使用动态名称"
      },
      {
        "name": "adgroup_id",
        "displayName": "广告组ID",
        "dataType": "str",
        "reportingMode": "P2｜归因可得时",
        "description": "可选；稳定ID"
      },
      {
        "name": "creative_id",
        "displayName": "素材ID",
        "dataType": "str",
        "reportingMode": "P2｜归因可得时",
        "description": "可选；稳定ID"
      }
    ]
  },
  {
    "id": "V18-EVT-023",
    "module": "核心行为",
    "standardEventName": "business_task_completed",
    "displayName": "业务任务完成",
    "analysisGoal": "统一清理扫描等异步业务任务完成结果。",
    "platforms": "Android/iOS",
    "trackingLocation": "业务UseCase/Repository返回最终结果后。",
    "triggerTiming": "任务成功、失败或取消形成终态时。",
    "metricPurpose": "任务完成率、耗时、业务功能使用UV",
    "sourceAlias": "iwxcleaner_scan_completed",
    "priority": "P1",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "task_type",
        "displayName": "任务类型",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；clean_scan等稳定业务枚举"
      },
      {
        "name": "result_status",
        "displayName": "任务状态",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；completed/failed/cancelled"
      },
      {
        "name": "duration_ms",
        "displayName": "任务耗时",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；整数毫秒"
      },
      {
        "name": "item_count",
        "displayName": "处理对象数",
        "dataType": "int",
        "reportingMode": "P2｜按需触发",
        "description": "可选；扫描或处理的对象数量"
      }
    ]
  },
  {
    "id": "V18-EVT-024",
    "module": "核心行为",
    "standardEventName": "core_action",
    "displayName": "核心功能行为",
    "analysisGoal": "记录VPN连接、节点选择等核心产品动作，判断广告机会前置行为是否完成。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "业务UseCase/Repository成功或失败结果回调，不在按钮点击即认定成功。",
    "triggerTiming": "每个核心动作完成或失败时。",
    "metricPurpose": "核心行为转化、广告机会触达、用户质量",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "action_name",
        "displayName": "动作名称",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；vpn_connect/vpn_disconnect/node_select等"
      },
      {
        "name": "action_result",
        "displayName": "动作结果",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；success/failed/cancelled/blocked"
      },
      {
        "name": "duration_ms",
        "displayName": "动作耗时",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；动作开始到终态毫秒数"
      },
      {
        "name": "error_code",
        "displayName": "业务错误码",
        "dataType": "str",
        "reportingMode": "P0｜失败时触发",
        "description": "条件必传；稳定机器码，成功为空"
      }
    ]
  },
  {
    "id": "V18-EVT-025",
    "module": "接口质量",
    "standardEventName": "api_request_result",
    "displayName": "接口请求结果",
    "analysisGoal": "统一业务接口成功、失败、耗时和错误阶段，不再使用api_error/api_success复合事件名。",
    "platforms": "Android/iOS",
    "trackingLocation": "统一HTTP拦截器在响应、异常或超时终态处。",
    "triggerTiming": "每次请求结束。",
    "metricPurpose": "接口成功率、错误码、国家/版本网络异常、接口耗时",
    "sourceAlias": "api_error/api_success",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "api_name",
        "displayName": "接口名称",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；稳定接口枚举，不直接用包含参数的完整URL"
      },
      {
        "name": "success",
        "displayName": "是否成功",
        "dataType": "bool",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；true/false"
      },
      {
        "name": "http_code",
        "displayName": "HTTP状态码",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；无响应时为0"
      },
      {
        "name": "duration_ms",
        "displayName": "接口耗时",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；请求开始到终态的毫秒数"
      },
      {
        "name": "error_stage",
        "displayName": "失败阶段",
        "dataType": "str",
        "reportingMode": "P2｜失败时触发",
        "description": "可选；dns/connect/tls/timeout/http/business/parse"
      },
      {
        "name": "error_code",
        "displayName": "错误码",
        "dataType": "str",
        "reportingMode": "P0｜失败时触发",
        "description": "条件必传；客户端或服务端标准错误码"
      },
      {
        "name": "request_trace_id",
        "displayName": "接口追踪ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；同一业务请求及其重试共享"
      },
      {
        "name": "retry_index",
        "displayName": "接口重试序号",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；首次0，后续递增"
      }
    ]
  },
  {
    "id": "V18-EVT-026",
    "module": "上报健康",
    "standardEventName": "telemetry_backend_ack",
    "displayName": "中台ACK结果",
    "analysisGoal": "区分HTTP成功和服务端真实接收。",
    "platforms": "Android/iOS",
    "trackingLocation": "BackendUploader解析服务端ACK后。",
    "triggerTiming": "每个收到有效ACK的批次一次；2xx但ACK无效必须走telemetry_batch_failed。",
    "metricPurpose": "ACK成功率、最终送达率",
    "sourceAlias": "缓存与双链路规范补充",
    "priority": "P1",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "batch_id",
        "displayName": "批次ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；本次上传批次"
      },
      {
        "name": "accepted_count",
        "displayName": "接收数量",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；服务端accepted数量"
      },
      {
        "name": "rejected_count",
        "displayName": "拒绝数量",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；服务端rejected数量"
      },
      {
        "name": "ack_duration_ms",
        "displayName": "ACK耗时",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；发送到收到ACK的毫秒数"
      },
      {
        "name": "http_status",
        "displayName": "HTTP状态",
        "dataType": "int",
        "reportingMode": "P2｜每次触发",
        "description": "可选；有效ACK对应的2xx状态码"
      },
      {
        "name": "request_duration_ms",
        "displayName": "请求耗时",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；发送开始至有效ACK校验完成的整数毫秒"
      },
      {
        "name": "queue_size_after",
        "displayName": "ACK后队列长度",
        "dataType": "int",
        "reportingMode": "P2｜每次触发",
        "description": "可选；accepted事件出队后的本地队列长度"
      }
    ]
  },
  {
    "id": "V18-EVT-027",
    "module": "上报健康",
    "standardEventName": "telemetry_batch_failed",
    "displayName": "中台批次失败",
    "analysisGoal": "定位DNS、超时、SSL、4xx、5xx等导致中台DAU偏低的问题。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Telemetry SDK网络异常或服务端非成功响应回调。",
    "triggerTiming": "每次发送失败；进入本地重试队列。",
    "metricPurpose": "上报失败率、错误分布、版本/国家/网络异常",
    "sourceAlias": "原完整变现规范",
    "priority": "P2",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "batch_id",
        "displayName": "批次ID",
        "dataType": "str",
        "reportingMode": "P2｜失败触发",
        "description": "可选；关联发送批次"
      },
      {
        "name": "error_type",
        "displayName": "失败类型",
        "dataType": "str",
        "reportingMode": "P2｜失败触发",
        "description": "可选；dns_failed/connect_timeout/read_timeout/ssl_error/http_4xx/http_5xx/network_unavailable/invalid_response/unknown"
      },
      {
        "name": "http_status",
        "displayName": "HTTP状态",
        "dataType": "int",
        "reportingMode": "P2｜失败触发",
        "description": "可选；无响应填0"
      },
      {
        "name": "request_duration_ms",
        "displayName": "失败耗时",
        "dataType": "int",
        "reportingMode": "P2｜失败触发",
        "description": "可选；毫秒"
      },
      {
        "name": "queue_size",
        "displayName": "当前队列长度",
        "dataType": "int",
        "reportingMode": "P2｜失败触发",
        "description": "可选；失败后待重试事件数"
      },
      {
        "name": "oldest_event_age_ms",
        "displayName": "最老事件年龄",
        "dataType": "int",
        "reportingMode": "P2｜失败触发",
        "description": "可选；毫秒"
      }
    ]
  },
  {
    "id": "V18-EVT-028",
    "module": "上报健康",
    "standardEventName": "telemetry_batch_send",
    "displayName": "中台批次发送",
    "analysisGoal": "监测客户端是否真实尝试向中台发送事件。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Telemetry SDK网络发送器；请求发出前。",
    "triggerTiming": "每个批次发送前；健康摘要可同时发Firebase。",
    "metricPurpose": "发送批次、事件发送量、积压程度、重试分布",
    "sourceAlias": "原完整变现规范",
    "priority": "P1",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "batch_id",
        "displayName": "批次ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；一次HTTP批次唯一ID"
      },
      {
        "name": "event_count",
        "displayName": "批次事件数",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；本批次事件条数"
      }
    ]
  },
  {
    "id": "V18-EVT-029",
    "module": "上报健康",
    "standardEventName": "telemetry_event_dropped",
    "displayName": "事件最终丢弃",
    "analysisGoal": "补回01权威事件总表，保证丢失率可配置、可测试。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "统一埋点SDK/outbox最终丢弃分支。",
    "triggerTiming": "超过最大重试、队列淘汰或载荷校验失败时。",
    "metricPurpose": "事件丢弃率、丢弃原因分布",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "original_event_name",
        "displayName": "原事件名",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；被丢弃的标准事件名"
      },
      {
        "name": "drop_reason",
        "displayName": "丢弃原因",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；queue_full/max_retry/invalid_payload/oversize/privacy_blocked/unknown"
      },
      {
        "name": "retry_count",
        "displayName": "重试次数",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；整数"
      },
      {
        "name": "queue_size",
        "displayName": "队列长度",
        "dataType": "int",
        "reportingMode": "P2｜每次触发",
        "description": "可选；丢弃发生时队列长度"
      }
    ]
  },
  {
    "id": "V18-EVT-030",
    "module": "上报健康",
    "standardEventName": "telemetry_event_enqueued",
    "displayName": "事件进入本地队列",
    "analysisGoal": "补回01权威事件总表，建立事件生成到发送的可靠链路。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "AnalyticsRepository写入本地outbox事务成功后。",
    "triggerTiming": "中台直传必达阶段每条关键事件入队成功时。",
    "metricPurpose": "入队成功率、生成→发送漏损",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "original_event_id",
        "displayName": "原事件ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联原业务事件event_id"
      },
      {
        "name": "original_event_name",
        "displayName": "原事件名",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；标准事件名"
      },
      {
        "name": "priority",
        "displayName": "队列优先级",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；p0/p1/p2"
      }
    ]
  },
  {
    "id": "V18-EVT-031",
    "module": "实验与配置",
    "standardEventName": "experiment_exposure",
    "displayName": "实验真实曝光",
    "analysisGoal": "只对真正看到实验方案的用户分析实验效果，避免将分组当曝光。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "实验UI或策略真正应用到用户可见/可执行场景时。",
    "triggerTiming": "每实验、每变体、每会话按配置去重后触发。",
    "metricPurpose": "实验曝光UV、实验漏曝光率、变体转化与收入差异",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "experiment_id",
        "displayName": "实验ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；稳定实验ID"
      },
      {
        "name": "experiment_version",
        "displayName": "实验版本",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；发布版本号"
      },
      {
        "name": "variant_id",
        "displayName": "变体ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；control/treatment或稳定变体ID"
      },
      {
        "name": "screen_name",
        "displayName": "曝光页面",
        "dataType": "str",
        "reportingMode": "P1｜按需触发",
        "description": "可选；稳定页面英文枚举"
      },
      {
        "name": "exposure_source",
        "displayName": "曝光来源",
        "dataType": "str",
        "reportingMode": "P2｜每次触发",
        "description": "可选；ui/policy/config/unknown"
      }
    ]
  },
  {
    "id": "V18-EVT-032",
    "module": "实验与配置",
    "standardEventName": "remote_config_result",
    "displayName": "远程配置结果",
    "analysisGoal": "确定每个用户实际拉取和生效的配置版本，定位默认值回退与配置故障。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Firebase Remote Config或自研配置SDK fetch/activate最终回调。",
    "triggerTiming": "每次配置拉取形成终态；进程内相同版本可去重。",
    "metricPurpose": "配置成功率、应用率、P95耗时、默认值回退率、版本覆盖",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "config_version",
        "displayName": "配置版本",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；服务端发布版本"
      },
      {
        "name": "config_source",
        "displayName": "配置来源",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；remote/cache/default/fallback"
      },
      {
        "name": "fetch_result",
        "displayName": "拉取结果",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；success/failed/timeout/not_modified"
      },
      {
        "name": "apply_result",
        "displayName": "应用结果",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；success/failed/skipped"
      },
      {
        "name": "duration_ms",
        "displayName": "配置耗时",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；fetch到activate完成的整数毫秒"
      },
      {
        "name": "error_code",
        "displayName": "配置错误码",
        "dataType": "str",
        "reportingMode": "P1｜失败触发",
        "description": "条件必传；稳定机器码"
      }
    ]
  },
  {
    "id": "V18-EVT-033",
    "module": "数据质量",
    "standardEventName": "context_provider_unavailable",
    "displayName": "上下文Provider不可用",
    "analysisGoal": "区分字段天然不可得、权限限制、SDK未初始化和研发漏接。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "统一Analytics Context Provider读取公共/条件字段失败处。",
    "triggerTiming": "核心Provider首次失败、状态变化或按分钟聚合后触发，禁止每字段无限刷事件。",
    "metricPurpose": "Provider可用率、字段缺失归因、P0/P1完整率解释",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "provider_name",
        "displayName": "Provider名称",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；稳定Provider英文名"
      },
      {
        "name": "field_name",
        "displayName": "不可用字段",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；标准字段名"
      },
      {
        "name": "availability_reason",
        "displayName": "不可用原因",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；permission_denied/sdk_not_ready/platform_unsupported/timeout/privacy_restricted/unknown"
      },
      {
        "name": "error_code",
        "displayName": "Provider错误码",
        "dataType": "str",
        "reportingMode": "P2｜失败可得时",
        "description": "可选；稳定短错误码"
      }
    ]
  },
  {
    "id": "V18-EVT-034",
    "module": "网络环境",
    "standardEventName": "network_environment_changed",
    "displayName": "网络环境变化",
    "analysisGoal": "识别俄罗斯、伊朗等弱网下有效网络切换、网络丢失或恢复对VPN连接与重连的影响。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "系统网络可达性/路径监听器；Android ConnectivityManager、iOS NWPathMonitor等平台实现。",
    "triggerTiming": "仅在Wi-Fi/蜂窝有效切换、网络丢失或恢复时触发；初始快照、相同状态重复回调以及蜂窝代际/漫游/IP族/门户属性单独变化不触发；默认2秒合并去抖，VPN状态机确认中断时可立即上报。",
    "metricPurpose": "网络切换率、网络恢复率、各网络类型连接成功率、切网断连率",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "change_reason",
        "displayName": "变化原因",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；wifi_to_cellular/cellular_to_wifi/lost/recovered/other/unknown"
      },
      {
        "name": "network_type",
        "displayName": "网络类型",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；wifi/cellular/ethernet/none/unknown"
      },
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P1｜VPN连接中条件触发",
        "description": "条件必传；当前VPN会话；未连接省略"
      },
      {
        "name": "connection_id",
        "displayName": "连接尝试ID",
        "dataType": "str",
        "reportingMode": "P1｜存在活动/已建立连接时",
        "description": "条件必传；当前连接尝试或建立隧道的connection_id；不可得时省略"
      }
    ]
  },
  {
    "id": "V18-EVT-035",
    "module": "页面行为",
    "standardEventName": "element_click",
    "displayName": "元素点击",
    "analysisGoal": "统一所有页面按钮、Tab、滑动和业务入口点击，避免为每个按钮创建独立事件。",
    "platforms": "Android/iOS",
    "trackingLocation": "统一UI点击代理层、Compose Modifier.clickable、View.OnClickListener或导航组件点击封装。",
    "triggerTiming": "用户真实完成一次点击/滑动动作时。",
    "metricPurpose": "元素点击PV/UV、页面点击率、关键路径转化",
    "sourceAlias": "element_click及全部iwxcleaner_*_click历史事件",
    "priority": "P1",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "element_name",
        "displayName": "元素名称",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；稳定英文枚举，不上传动态文案"
      },
      {
        "name": "action_name",
        "displayName": "动作名称",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；continue/delete/merge/back/swipe_up等标准动作"
      },
      {
        "name": "content_type",
        "displayName": "业务内容类型",
        "dataType": "str",
        "reportingMode": "P2｜按需触发",
        "description": "可选；photo/video/contacts/calendar/private等"
      },
      {
        "name": "scene",
        "displayName": "业务场景",
        "dataType": "str",
        "reportingMode": "P2｜按需触发",
        "description": "可选；订阅或功能触发场景"
      },
      {
        "name": "tab_name",
        "displayName": "Tab名称",
        "dataType": "str",
        "reportingMode": "P2｜按需触发",
        "description": "可选；稳定英文Tab枚举"
      }
    ]
  },
  {
    "id": "V18-EVT-036",
    "module": "页面行为",
    "standardEventName": "screen_exit",
    "displayName": "离开页面",
    "analysisGoal": "用户离开当前广告场景；App可能仍在前台。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "统一Navigation监听器；Fragment.onDestroyView；Compose DisposableEffect.onDispose。",
    "triggerTiming": "每次有效页面访问结束一次。",
    "metricPurpose": "页面停留、user_left_page广告损耗、退出路径",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "screen_name",
        "displayName": "离开页面",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；原页面名称"
      },
      {
        "name": "next_screen",
        "displayName": "目标页面",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；App内目标页面；进入后台可为空"
      },
      {
        "name": "exit_action",
        "displayName": "退出动作",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；back/tab_switch/navigate/close/flow_cancelled"
      },
      {
        "name": "screen_duration_ms",
        "displayName": "页面停留时长",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；页面可见到退出的毫秒数"
      },
      {
        "name": "app_state",
        "displayName": "App状态",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；foreground/background；用于区分用户离页和App后台"
      },
      {
        "name": "screen_view_id",
        "displayName": "页面访问ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联本次screen_view"
      }
    ]
  },
  {
    "id": "V18-EVT-037",
    "module": "页面行为",
    "standardEventName": "screen_view",
    "displayName": "页面展示",
    "analysisGoal": "记录页面真实可见，是页面访问漏斗和页面级广告场景的基础分母。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Navigation destination监听器；Compose页面LaunchedEffect；Fragment首次可见。",
    "triggerTiming": "每次页面真正可见时一次；同一次页面访问内保持不变。",
    "metricPurpose": "页面UV/PV、页面到达率、广告场景覆盖率",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "screen_name",
        "displayName": "页面名称",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；稳定页面英文枚举；禁止动态文案"
      },
      {
        "name": "previous_screen",
        "displayName": "来源页面",
        "dataType": "str",
        "reportingMode": "P1｜存在上一页面时",
        "description": "条件必传；稳定页面英文枚举；首次进入或无法判断时省略"
      },
      {
        "name": "screen_view_id",
        "displayName": "页面访问ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；每次页面访问唯一UUID；关联页面就绪/异常/退出事件"
      }
    ]
  },
  {
    "id": "V18-EVT-038",
    "module": "隐私与SDK",
    "standardEventName": "ad_sdk_init_failed",
    "displayName": "广告SDK初始化失败",
    "analysisGoal": "定位广告请求用户覆盖不足的SDK问题。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "初始化异常、超时或业务超时保护分支。",
    "triggerTiming": "初始化失败或超过约定超时阈值。",
    "metricPurpose": "SDK失败率、初始化错误分布",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "init_duration_ms",
        "displayName": "初始化耗时",
        "dataType": "int",
        "reportingMode": "P2｜失败触发",
        "description": "可选；毫秒"
      },
      {
        "name": "error_code",
        "displayName": "初始化错误码",
        "dataType": "str",
        "reportingMode": "P0｜失败触发",
        "description": "条件必传；内部稳定错误码"
      }
    ]
  },
  {
    "id": "V18-EVT-039",
    "module": "隐私与SDK",
    "standardEventName": "ad_sdk_init_start",
    "displayName": "广告SDK开始初始化",
    "analysisGoal": "判断初始化是否启动及启动时机。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Application广告初始化管理器，调用MobileAds.initialize前。",
    "triggerTiming": "每进程一次。",
    "metricPurpose": "SDK初始化覆盖率、初始化遗漏用户",
    "sourceAlias": "原完整变现规范",
    "priority": "P1",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "consent_status",
        "displayName": "初始化时授权状态",
        "dataType": "str",
        "reportingMode": "P1｜每进程一次",
        "description": "条件必传；初始化调用时的UMP状态"
      },
      {
        "name": "network_type",
        "displayName": "网络类型",
        "dataType": "str",
        "reportingMode": "P2｜每进程一次",
        "description": "可选；wifi/cellular/none/unknown"
      }
    ]
  },
  {
    "id": "V18-EVT-040",
    "module": "隐私与SDK",
    "standardEventName": "ad_sdk_init_success",
    "displayName": "广告SDK初始化成功",
    "analysisGoal": "确认用户具备请求AdMob的技术条件。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "MobileAds.initialize完成回调。",
    "triggerTiming": "每进程成功一次。",
    "metricPurpose": "SDK初始化成功用户率、初始化耗时",
    "sourceAlias": "原完整变现规范",
    "priority": "P2",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "init_duration_ms",
        "displayName": "初始化耗时",
        "dataType": "int",
        "reportingMode": "P2｜成功触发",
        "description": "可选；毫秒"
      },
      {
        "name": "sdk_version",
        "displayName": "SDK版本",
        "dataType": "str",
        "reportingMode": "P2｜成功触发",
        "description": "可选；Google Mobile Ads SDK版本"
      },
      {
        "name": "adapter_status",
        "displayName": "适配器状态摘要",
        "dataType": "str",
        "reportingMode": "P2｜成功触发",
        "description": "可选；ready/not_ready数量或摘要"
      }
    ]
  },
  {
    "id": "V18-EVT-041",
    "module": "隐私与SDK",
    "standardEventName": "consent_result",
    "displayName": "隐私授权结果",
    "analysisGoal": "区分隐私流程造成的广告资格和eCPM差异。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Google UMP ConsentInformation/Form回调。",
    "triggerTiming": "隐私状态获取或表单完成后。",
    "metricPurpose": "授权完成率、个性化允许率、授权状态eCPM",
    "sourceAlias": "原完整变现规范",
    "priority": "P1",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "consent_status",
        "displayName": "授权状态",
        "dataType": "str",
        "reportingMode": "P1｜结果触发",
        "description": "条件必传；obtained/required/not_required/unknown"
      },
      {
        "name": "privacy_region",
        "displayName": "隐私区域",
        "dataType": "str",
        "reportingMode": "P2｜结果触发",
        "description": "可选；EEA/UK/CH/US/other/unknown"
      },
      {
        "name": "personalized_allowed",
        "displayName": "允许个性化",
        "dataType": "bool",
        "reportingMode": "P2｜结果触发",
        "description": "可选；是否允许个性化广告"
      },
      {
        "name": "form_shown",
        "displayName": "是否展示表单",
        "dataType": "bool",
        "reportingMode": "P2｜结果触发",
        "description": "可选；1=展示"
      },
      {
        "name": "form_result",
        "displayName": "表单结果",
        "dataType": "str",
        "reportingMode": "P2｜结果触发",
        "description": "可选；accepted/rejected/dismissed/error/not_shown"
      }
    ]
  },
  {
    "id": "V18-EVT-042",
    "module": "App生命周期",
    "standardEventName": "app_background",
    "displayName": "进入后台",
    "analysisGoal": "整个App失去前台状态，不等于离开当前页面。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "App lifecycle observer检测整个App进入后台；Android可映射ProcessLifecycleOwner，iOS映射UIApplication/Scene lifecycle。不得用单页面离开替代App后台。",
    "triggerTiming": "按Home、切换App、锁屏等导致整个App进入后台。",
    "metricPurpose": "会话时长、短会话率、后台导致广告未展示比例",
    "sourceAlias": "原完整变现规范",
    "priority": "P1",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "current_screen",
        "displayName": "当前页面",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；进入后台前最后可见页面"
      },
      {
        "name": "session_duration_ms",
        "displayName": "会话时长",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；本次前台会话持续毫秒数"
      },
      {
        "name": "background_reason",
        "displayName": "后台原因",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；home_or_switch_app/screen_off/system_interruption/unknown"
      },
      {
        "name": "pending_ad_count",
        "displayName": "待消费广告数",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；已加载但未产生终态的广告对象数量"
      }
    ]
  },
  {
    "id": "V18-EVT-043",
    "module": "App生命周期",
    "standardEventName": "app_first_open",
    "displayName": "首次打开",
    "analysisGoal": "安装后第一次启动，用于安装、首开和新用户识别。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Application启动初始化层；本地持久化first_open_sent=false时触发。",
    "triggerTiming": "每次安装仅一次；Firebase首期由本地first_open_sent标记保证一次性触发并直接logEvent；中台直传必达阶段才先写入本地outbox，服务端ACK后出队。",
    "metricPurpose": "首开用户、安装→首开率、新增用户、渠道首开率",
    "sourceAlias": "原完整变现规范",
    "priority": "P2",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "install_time",
        "displayName": "安装时间",
        "dataType": "timestamp",
        "reportingMode": "P2｜首次触发",
        "description": "可选；首次安装时间；没有可靠安装时间时取首次启动时间"
      },
      {
        "name": "is_reinstall",
        "displayName": "是否重装",
        "dataType": "bool",
        "reportingMode": "P2｜首次触发",
        "description": "可选；1=可能重装；0=首次安装；仅作辅助判断"
      },
      {
        "name": "install_source",
        "displayName": "安装来源",
        "dataType": "str",
        "reportingMode": "P2｜首次触发",
        "description": "可选；Google Play、第三方商店、预装、未知"
      }
    ]
  },
  {
    "id": "V18-EVT-044",
    "module": "App生命周期",
    "standardEventName": "app_foreground",
    "displayName": "进入前台",
    "analysisGoal": "中台DAU的基准事件，代表App进入可交互前台。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "App lifecycle observer检测整个App进入前台；Android/iOS按各自生命周期API实现。",
    "triggerTiming": "每次App从后台进入前台时上报一次；首次启动进入前台也上报。",
    "metricPurpose": "中台DAU、会话数、回访率、Firebase DAU对账",
    "sourceAlias": "原完整变现规范",
    "priority": "P1",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "foreground_reason",
        "displayName": "进入前台原因",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；first_open/resume/notification/deep_link/unknown"
      },
      {
        "name": "previous_background_ms",
        "displayName": "上次后台时长",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；毫秒；首次会话为0"
      },
      {
        "name": "session_index",
        "displayName": "安装后会话序号",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；从1开始递增"
      },
      {
        "name": "launch_type",
        "displayName": "启动类型",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；cold_start/resume"
      }
    ]
  },
  {
    "id": "V18-EVT-045",
    "module": "App生命周期",
    "standardEventName": "app_once_params",
    "displayName": "一次性参数",
    "analysisGoal": "SDK初始化后记录本次运行环境和功能快照，避免每条事件重复上报。",
    "platforms": "Android/iOS",
    "trackingLocation": "统一Analytics/SDK初始化完成后；远程配置应用状态以当前快照为准。",
    "triggerTiming": "埋点SDK初始化完成后每进程上报一次；进程内不得重复。",
    "metricPurpose": "运行环境分群、问题定位、远程配置生效判断",
    "sourceAlias": "V1.7公共参数/一次性参数调整",
    "priority": "P1",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "consent_status",
        "displayName": "隐私授权状态",
        "dataType": "str",
        "reportingMode": "P2｜SDK初始化后每进程一次",
        "description": "可选；SDK初始化后一次性快照；授权变化另由 consent_result 事件记录。"
      },
      {
        "name": "personalized_allowed",
        "displayName": "是否允许个性化广告",
        "dataType": "bool",
        "reportingMode": "P2｜SDK初始化后每进程一次",
        "description": "可选；SDK初始化后一次性快照；可得时传。"
      },
      {
        "name": "ip_before_status",
        "displayName": "连接前IP状态",
        "dataType": "str",
        "reportingMode": "P1｜SDK初始化后每进程一次",
        "description": "条件必传；success/failed/timeout/not_started/unknown；ip_before_connect/ip_after_connect明文进入Firebase"
      },
      {
        "name": "country_code",
        "displayName": "启动国家/地区码",
        "dataType": "str",
        "reportingMode": "P1｜SDK初始化后每进程一次",
        "description": "条件必传；启动时识别国家/地区；优先 IP 定位或业务 Provider。"
      },
      {
        "name": "city",
        "displayName": "启动城市",
        "dataType": "str",
        "reportingMode": "P2｜SDK初始化后每进程一次",
        "description": "可选；启动时 IP 定位城市；可得时传。"
      },
      {
        "name": "device_model",
        "displayName": "设备型号",
        "dataType": "str",
        "reportingMode": "P1｜SDK初始化后每进程一次",
        "description": "条件必传；设备型号；Firebase自动可得时客户端不重复作为普通公共参数。"
      },
      {
        "name": "os_name",
        "displayName": "操作系统",
        "dataType": "str",
        "reportingMode": "P2｜SDK初始化后每进程一次",
        "description": "可选；如 iOS/Android。"
      },
      {
        "name": "os_version",
        "displayName": "系统版本",
        "dataType": "str",
        "reportingMode": "P1｜SDK初始化后每进程一次",
        "description": "条件必传；系统版本；Firebase自动可得时客户端不重复作为普通公共参数。"
      },
      {
        "name": "app_version",
        "displayName": "App版本",
        "dataType": "str",
        "reportingMode": "P1｜SDK初始化后每进程一次",
        "description": "条件必传；App版本；Firebase自动可得时客户端不重复作为普通公共参数。"
      },
      {
        "name": "app_build",
        "displayName": "构建号",
        "dataType": "int",
        "reportingMode": "P1｜SDK初始化后每进程一次",
        "description": "条件必传；App build/versionCode；SDK初始化后一次性传。"
      },
      {
        "name": "locale_language",
        "displayName": "本地语言",
        "dataType": "str",
        "reportingMode": "P2｜SDK初始化后每进程一次",
        "description": "可选；系统语言；需要原始客户端值时在一次性参数中传。"
      },
      {
        "name": "locale_country",
        "displayName": "本地国家",
        "dataType": "str",
        "reportingMode": "P2｜SDK初始化后每进程一次",
        "description": "可选；系统地区；启动环境快照。"
      },
      {
        "name": "timezone",
        "displayName": "客户端时区",
        "dataType": "str",
        "reportingMode": "P2｜SDK初始化后每进程一次",
        "description": "可选；IANA时区或UTC offset；启动环境快照。"
      },
      {
        "name": "open_times",
        "displayName": "安装后打开次数",
        "dataType": "int",
        "reportingMode": "P2｜SDK初始化后每进程一次",
        "description": "可选；从1开始；本次启动维度。"
      },
      {
        "name": "is_subscriber",
        "displayName": "是否订阅用户",
        "dataType": "bool",
        "reportingMode": "P2｜SDK初始化后每进程一次",
        "description": "可选；SDK初始化时订阅状态快照；不确定时不伪造。"
      },
      {
        "name": "remote_config_applied",
        "displayName": "远程配置是否已应用",
        "dataType": "bool",
        "reportingMode": "P1｜SDK初始化后每进程一次",
        "description": "条件必传；true 表示本次已经拿到并应用 Firebase Remote Config；false 表示仍用默认/兜底配置。"
      }
    ]
  },
  {
    "id": "V18-EVT-046",
    "module": "App生命周期",
    "standardEventName": "app_start_complete",
    "displayName": "App启动完成",
    "analysisGoal": "判断冷启动是否完成、首屏是否可交互以及启动阶段流失。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Application/Scene初始化协调器；必要SDK初始化完成且首屏可交互处。",
    "triggerTiming": "每次冷启动或暖启动完成一次；失败也要形成终态。",
    "metricPurpose": "启动完成率、冷启动P50/P95、启动失败模块分布、启动→首屏转化",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "start_type",
        "displayName": "启动类型",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；cold/warm/hot/unknown"
      },
      {
        "name": "startup_duration_ms",
        "displayName": "启动耗时",
        "dataType": "int",
        "reportingMode": "P0｜每次触发",
        "description": "必传；进程/场景启动至首屏可交互的整数毫秒"
      },
      {
        "name": "first_screen",
        "displayName": "首个页面",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；稳定页面英文枚举"
      },
      {
        "name": "init_result",
        "displayName": "初始化结果",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；success/partial/failed/timeout"
      },
      {
        "name": "failed_module",
        "displayName": "失败模块",
        "dataType": "str",
        "reportingMode": "P1｜失败触发",
        "description": "条件必传；config/analytics/vpn/ads/other/unknown"
      }
    ]
  },
  {
    "id": "V18-EVT-047",
    "module": "App生命周期",
    "standardEventName": "session_heartbeat",
    "displayName": "前台心跳",
    "analysisGoal": "验证长会话和中台上报链路，避免进程被杀导致会话结束丢失。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "Application前台定时任务；仅前台运行。",
    "triggerTiming": "App处于前台时每3～5分钟上报一次；进入后台立即停止。",
    "metricPurpose": "有效活跃时长、心跳覆盖率、上报中断用户",
    "sourceAlias": "原完整变现规范",
    "priority": "P2",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点",
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "foreground_duration_ms",
        "displayName": "累计前台时长",
        "dataType": "int",
        "reportingMode": "P2｜定时触发",
        "description": "可选；当前会话累计前台毫秒"
      },
      {
        "name": "queue_size",
        "displayName": "本地事件队列长度",
        "dataType": "int",
        "reportingMode": "P2｜定时触发",
        "description": "可选；仅中台直传/必达链路适用；Firebase首期无outbox时省略"
      }
    ]
  },
  {
    "id": "V18-EVT-048",
    "module": "Banner专项",
    "standardEventName": "banner_visible",
    "displayName": "Banner实际可见",
    "analysisGoal": "识别Banner已加载但被遮挡、未挂载或离开可视区域。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "AdView挂载后结合View可见性、窗口焦点和可视区域监听。",
    "triggerTiming": "可见状态变化；避免高频抖动，建议状态切换触发。",
    "metricPurpose": "Banner可见率、加载未展示原因、有效曝光时长",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "session_id",
    "sourceSheets": [
      "01A_广告变现打点"
    ],
    "parameters": [
      {
        "name": "request_id",
        "displayName": "客户端请求ID",
        "dataType": "str",
        "reportingMode": "P0｜状态变化触发",
        "description": "条件必传；关联Banner请求"
      },
      {
        "name": "is_visible",
        "displayName": "是否实际可见",
        "dataType": "bool",
        "reportingMode": "P2｜状态变化触发",
        "description": "可选；可见且未被遮挡的业务判断"
      },
      {
        "name": "visibility_reason",
        "displayName": "不可见原因",
        "dataType": "str",
        "reportingMode": "P2｜is_visible=false",
        "description": "可选；detached/covered/offscreen/page_hidden/app_background/size_zero/unknown"
      },
      {
        "name": "visible_duration_ms",
        "displayName": "本次可见时长",
        "dataType": "int",
        "reportingMode": "P2｜变为不可见触发",
        "description": "可选；毫秒"
      }
    ]
  },
  {
    "id": "V18-EVT-049",
    "module": "VPN IP",
    "standardEventName": "vpn_ip_probe_result",
    "displayName": "VPN连接前后IP探测结果",
    "analysisGoal": "诊断连接前后IP采集失败、出口未变化、GeoIP/ASN错误和隧道路由问题。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "公司自有IP回显服务Provider；连接前及隧道ready后分别调用。",
    "triggerTiming": "before/after/recheck每次探测形成终态；失败不得用before值回填after。",
    "metricPurpose": "before/after采集率、IP变化率、国家一致率、ASN/ISP分布、探测P95",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；绑定before/after与广告请求"
      },
      {
        "name": "probe_stage",
        "displayName": "探测阶段",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；before_connect/after_connect/recheck"
      },
      {
        "name": "probe_result",
        "displayName": "探测结果",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；success/failed/timeout/invalid_response"
      },
      {
        "name": "duration_ms",
        "displayName": "探测耗时",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；整数毫秒"
      },
      {
        "name": "ip_family",
        "displayName": "IP协议族",
        "dataType": "str",
        "reportingMode": "P1｜成功触发",
        "description": "条件必传；ipv4/ipv6/dual/unknown"
      },
      {
        "name": "ip_changed",
        "displayName": "出口IP是否变化",
        "dataType": "bool",
        "reportingMode": "P1｜after成功时",
        "description": "条件必传；与before比较；before不可用时省略"
      },
      {
        "name": "error_code",
        "displayName": "探测错误码",
        "dataType": "str",
        "reportingMode": "P1｜失败触发",
        "description": "条件必传；稳定机器码"
      },
      {
        "name": "ip_hash",
        "displayName": "IP不可逆哈希",
        "dataType": "str",
        "reportingMode": "P1｜中台受控字段",
        "description": "条件必传；完整IP明文上报Firebase；中台可同步加密/哈希存档"
      },
      {
        "name": "country_code",
        "displayName": "IP国家",
        "dataType": "str",
        "reportingMode": "P1｜服务端派生",
        "description": "服务端派生；ISO国家码；禁止客户端伪造"
      },
      {
        "name": "asn",
        "displayName": "IP ASN",
        "dataType": "int",
        "reportingMode": "P1｜服务端派生",
        "description": "服务端派生；由公网IP派生"
      },
      {
        "name": "isp",
        "displayName": "IP运营商",
        "dataType": "str",
        "reportingMode": "P2｜服务端派生",
        "description": "服务端派生；标准化运营商名称/ID"
      }
    ]
  },
  {
    "id": "V18-EVT-050",
    "module": "VPN节点",
    "standardEventName": "vpn_node_selected",
    "displayName": "VPN节点选择",
    "analysisGoal": "解释最终选中了哪个节点、协议和传输组合，以及是手动还是自动选择。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "节点选择器输出最终候选后、真正连接前。",
    "triggerTiming": "每次连接尝试确定节点方案时；回退改选需要再次触发。",
    "metricPurpose": "节点选择分布、自动选择成功率、节点评分与实际成功率偏差",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联连接流程"
      },
      {
        "name": "server_id",
        "displayName": "节点ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；内部稳定ID"
      },
      {
        "name": "node_region",
        "displayName": "节点地区",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；ISO国家/地区码"
      },
      {
        "name": "selection_mode",
        "displayName": "选择方式",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；auto/manual/recommended/fallback"
      },
      {
        "name": "protocol",
        "displayName": "VPN协议",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；引用vpn_protocol枚举"
      },
      {
        "name": "transport",
        "displayName": "传输层",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；引用vpn_transport枚举"
      },
      {
        "name": "port",
        "displayName": "目标端口",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；1~65535"
      },
      {
        "name": "candidate_count",
        "displayName": "候选节点数",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；本次可选候选数量"
      },
      {
        "name": "selection_score_bucket",
        "displayName": "选择评分分桶",
        "dataType": "str",
        "reportingMode": "P2｜自动选择可得时",
        "description": "可选；excellent/good/fair/poor/unknown"
      },
      {
        "name": "config_version",
        "displayName": "VPN配置版本",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；节点配置版本"
      }
    ]
  },
  {
    "id": "V18-EVT-051",
    "module": "VPN节点",
    "standardEventName": "vpn_server_probe_result",
    "displayName": "VPN节点探测结果",
    "analysisGoal": "在连接前判断候选节点、协议和端口在俄罗斯/伊朗网络中的真实可达性。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "节点选择器的受控探测模块；只探测公司允许的节点目标。",
    "triggerTiming": "候选节点探测形成终态；建议只上报Top N候选与全部失败项。",
    "metricPurpose": "节点可达率、探测延迟、UDP/TCP/QUIC可达率、节点选择质量",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联连接流程"
      },
      {
        "name": "probe_id",
        "displayName": "探测ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；UUID"
      },
      {
        "name": "server_id",
        "displayName": "节点ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；内部稳定ID；禁止真实主机名/IP"
      },
      {
        "name": "node_region",
        "displayName": "节点地区",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；ISO国家/地区码"
      },
      {
        "name": "protocol",
        "displayName": "VPN协议",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；引用vpn_protocol枚举"
      },
      {
        "name": "transport",
        "displayName": "传输层",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；udp/tcp/quic/tls/websocket/http2/custom"
      },
      {
        "name": "port",
        "displayName": "目标端口",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；1~65535；只存端口不存目标地址"
      },
      {
        "name": "probe_result",
        "displayName": "探测结果",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；success/failed/timeout/cancelled"
      },
      {
        "name": "latency_ms",
        "displayName": "探测延迟",
        "dataType": "int",
        "reportingMode": "P1｜成功触发",
        "description": "条件必传；整数毫秒"
      },
      {
        "name": "packet_loss_pct",
        "displayName": "探测丢包率",
        "dataType": "double",
        "reportingMode": "P2｜可得时",
        "description": "可选；0~100"
      },
      {
        "name": "error_stage",
        "displayName": "失败阶段",
        "dataType": "str",
        "reportingMode": "P1｜失败触发",
        "description": "条件必传；dns/socket/tls/protocol/unknown"
      },
      {
        "name": "error_code",
        "displayName": "探测错误码",
        "dataType": "str",
        "reportingMode": "P1｜失败触发",
        "description": "条件必传；稳定机器码"
      }
    ]
  },
  {
    "id": "V18-EVT-052",
    "module": "VPN可用性",
    "standardEventName": "vpn_connectivity_check",
    "displayName": "VPN连接后可用性检查",
    "analysisGoal": "区分隧道已建立与用户真正可访问互联网，发现DNS、路由和出口不可用。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "隧道ready后，对公司允许的DNS/HTTPS探测目标执行检查。",
    "triggerTiming": "首次连接成功后必测一次；网络切换和异常恢复后可重测。",
    "metricPurpose": "连接后可用率、DNS成功率、HTTP成功率、隧道绕行率",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联当前VPN会话"
      },
      {
        "name": "connection_id",
        "displayName": "连接尝试ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；产生当前隧道的connection_id"
      },
      {
        "name": "check_type",
        "displayName": "检查类型",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；dns/https/ip_echo/route"
      },
      {
        "name": "target_id",
        "displayName": "探测目标ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；内部allowlist ID；禁止原始域名/URL"
      },
      {
        "name": "result_status",
        "displayName": "检查结果",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；success/failed/timeout"
      },
      {
        "name": "duration_ms",
        "displayName": "检查耗时",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；整数毫秒"
      },
      {
        "name": "http_status_class",
        "displayName": "HTTP状态类别",
        "dataType": "str",
        "reportingMode": "P2｜HTTP检查触发",
        "description": "可选；2xx/3xx/4xx/5xx/none"
      },
      {
        "name": "dns_result",
        "displayName": "DNS结果",
        "dataType": "str",
        "reportingMode": "P2｜DNS检查触发",
        "description": "可选；success/nxdomain/timeout/poisoned/failed/unknown"
      },
      {
        "name": "routed_through_vpn",
        "displayName": "是否经VPN路由",
        "dataType": "bool",
        "reportingMode": "P1｜可判断时",
        "description": "条件必传；0/1；通过出口IP/路由校验推断"
      },
      {
        "name": "error_code",
        "displayName": "检查错误码",
        "dataType": "str",
        "reportingMode": "P1｜失败触发",
        "description": "条件必传；稳定机器码"
      }
    ]
  },
  {
    "id": "V18-EVT-053",
    "module": "VPN控制面",
    "standardEventName": "vpn_config_fetch_result",
    "displayName": "VPN配置拉取结果",
    "analysisGoal": "定位节点列表、协议配置或签名配置未取得导致的连接失败。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "VPN配置/节点列表Repository请求最终回调。",
    "triggerTiming": "每次远程获取、缓存读取或兜底配置选择形成终态。",
    "metricPurpose": "配置拉取成功率、缓存命中率、P95耗时、配置版本覆盖",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联本次连接流程"
      },
      {
        "name": "request_trace_id",
        "displayName": "配置请求追踪ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；同一请求重试链路稳定ID"
      },
      {
        "name": "config_version",
        "displayName": "VPN配置版本",
        "dataType": "str",
        "reportingMode": "P1｜成功触发",
        "description": "条件必传；服务端发布版本"
      },
      {
        "name": "config_source",
        "displayName": "配置来源",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；remote/cache/default/fallback"
      },
      {
        "name": "result_status",
        "displayName": "拉取结果",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；success/failed/timeout"
      },
      {
        "name": "duration_ms",
        "displayName": "拉取耗时",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；整数毫秒"
      },
      {
        "name": "error_code",
        "displayName": "错误码",
        "dataType": "str",
        "reportingMode": "P1｜失败触发",
        "description": "条件必传；稳定机器码"
      }
    ]
  },
  {
    "id": "V18-EVT-054",
    "module": "VPN连接",
    "standardEventName": "vpn_connection_phase",
    "displayName": "VPN连接阶段结果",
    "analysisGoal": "精确定位DNS、Socket、TLS、协议握手、建隧道、路由、DNS应用和连通性检查的损耗。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "VPN连接状态机每个标准阶段结束处；只上报终态，不记录原始域名和地址。",
    "triggerTiming": "每阶段形成success/failed/timeout/cancelled/skipped终态时。",
    "metricPurpose": "阶段成功率、阶段P50/P95、首个失败阶段、俄罗斯/伊朗限制信号",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联连接流程"
      },
      {
        "name": "connection_id",
        "displayName": "连接尝试ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联vpn_connection_start"
      },
      {
        "name": "phase_name",
        "displayName": "连接阶段",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；config_fetch/dns_resolve/socket_connect/tls_handshake/protocol_handshake/tunnel_create/route_apply/dns_apply/connectivity_check/ready"
      },
      {
        "name": "phase_result",
        "displayName": "阶段结果",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；success/failed/timeout/cancelled/skipped"
      },
      {
        "name": "duration_ms",
        "displayName": "阶段耗时",
        "dataType": "int",
        "reportingMode": "P0｜每次触发",
        "description": "必传；整数毫秒"
      },
      {
        "name": "error_category",
        "displayName": "错误分类",
        "dataType": "str",
        "reportingMode": "P1｜失败触发",
        "description": "条件必传；引用vpn_error_category枚举"
      },
      {
        "name": "error_code",
        "displayName": "错误码",
        "dataType": "str",
        "reportingMode": "P1｜失败触发",
        "description": "条件必传；稳定机器码，禁止完整堆栈"
      },
      {
        "name": "server_id",
        "displayName": "节点ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；内部稳定ID"
      },
      {
        "name": "protocol",
        "displayName": "VPN协议",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；引用vpn_protocol枚举"
      },
      {
        "name": "retry_index",
        "displayName": "重试序号",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；同一会话内连接尝试序号"
      },
      {
        "name": "fallback_index",
        "displayName": "回退序号",
        "dataType": "int",
        "reportingMode": "P2｜每次触发",
        "description": "可选；协议/端口/节点回退序号"
      },
      {
        "name": "restriction_signal",
        "displayName": "网络限制信号",
        "dataType": "str",
        "reportingMode": "P1｜检测到时",
        "description": "条件必传；dns_poisoning/dns_timeout/udp_blocked/tcp_reset/tls_intercept/sni_blocked/ip_blocked/quic_blocked/throttling/captive_portal/unknown"
      }
    ]
  },
  {
    "id": "V18-EVT-055",
    "module": "VPN连接",
    "standardEventName": "vpn_connection_start",
    "displayName": "VPN连接开始",
    "analysisGoal": "建立真实连接尝试分母，发现无结果、卡死、杀进程和连接前退出。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "VPN连接状态机调用底层connect之前；ID必须先生成再执行连接。",
    "triggerTiming": "每次真实连接尝试一次；每次重试生成新的connection_id，vpn_session_id按V1.8会话规则复用。",
    "metricPurpose": "连接尝试数/用户、结果覆盖率、无结果率、开始→成功耗时",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；一次用户连接流程ID；自动重试沿用，用户重新连接新建"
      },
      {
        "name": "connection_id",
        "displayName": "连接尝试ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；每次底层connect调用唯一UUID"
      },
      {
        "name": "trigger_type",
        "displayName": "连接触发类型",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；manual/auto_connect/auto_reconnect/network_recovered/retry/fallback"
      },
      {
        "name": "retry_index",
        "displayName": "重试序号",
        "dataType": "int",
        "reportingMode": "P0｜每次触发",
        "description": "必传；首次0，同一vpn_session_id内递增"
      },
      {
        "name": "fallback_index",
        "displayName": "回退序号",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；首次0，切换协议/端口/节点递增"
      },
      {
        "name": "server_id",
        "displayName": "节点ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；内部稳定ID"
      },
      {
        "name": "node_region",
        "displayName": "节点地区",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；ISO国家/地区码"
      },
      {
        "name": "protocol",
        "displayName": "VPN协议",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；引用vpn_protocol枚举"
      },
      {
        "name": "transport",
        "displayName": "传输层",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；引用vpn_transport枚举"
      },
      {
        "name": "port",
        "displayName": "目标端口",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；1~65535"
      },
      {
        "name": "obfuscation_mode",
        "displayName": "混淆模式",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；none/tls/websocket/http2/quic/custom/unknown"
      },
      {
        "name": "ip_family",
        "displayName": "IP协议族",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；ipv4/ipv6/dual/unknown"
      },
      {
        "name": "route_mode",
        "displayName": "路由模式",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；full_tunnel/split_tunnel"
      },
      {
        "name": "mtu",
        "displayName": "配置MTU",
        "dataType": "int",
        "reportingMode": "P2｜可得时",
        "description": "可选；有效MTU整数；未知省略"
      }
    ]
  },
  {
    "id": "V18-EVT-056",
    "module": "VPN连接",
    "standardEventName": "vpn_protocol_fallback",
    "displayName": "VPN协议/节点回退",
    "analysisGoal": "衡量弱网环境下切换协议、传输、端口或节点是否真正提升连接成功率。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "连接策略引擎决定切换方案后、发起下一次connection_start前。",
    "triggerTiming": "每次策略回退一次；不得与普通retry混淆。",
    "metricPurpose": "回退率、回退恢复率、最佳协议/端口组合、无效回退次数",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联连接流程"
      },
      {
        "name": "connection_id",
        "displayName": "失败连接尝试ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；触发回退的connection_id"
      },
      {
        "name": "fallback_index",
        "displayName": "回退序号",
        "dataType": "int",
        "reportingMode": "P0｜每次触发",
        "description": "必传；从1开始递增"
      },
      {
        "name": "from_protocol",
        "displayName": "原协议",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；引用vpn_protocol枚举"
      },
      {
        "name": "to_protocol",
        "displayName": "新协议",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；引用vpn_protocol枚举"
      },
      {
        "name": "from_transport",
        "displayName": "原传输层",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；引用vpn_transport枚举"
      },
      {
        "name": "to_transport",
        "displayName": "新传输层",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；引用vpn_transport枚举"
      },
      {
        "name": "fallback_reason",
        "displayName": "回退原因",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；dns_failure/udp_blocked/tls_failure/timeout/server_unreachable/network_changed/policy/unknown"
      },
      {
        "name": "from_server_id",
        "displayName": "原节点ID",
        "dataType": "str",
        "reportingMode": "P2｜可得时",
        "description": "可选；内部稳定ID"
      },
      {
        "name": "to_server_id",
        "displayName": "新节点ID",
        "dataType": "str",
        "reportingMode": "P2｜可得时",
        "description": "可选；内部稳定ID"
      }
    ]
  },
  {
    "id": "V18-EVT-057",
    "module": "VPN权限",
    "standardEventName": "vpn_permission_result",
    "displayName": "VPN权限结果",
    "analysisGoal": "区分用户拒绝系统VPN权限与真实技术连接失败。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "系统VPN授权弹窗/配置安装结果回调。",
    "triggerTiming": "每次请求系统VPN权限形成granted/denied/error终态。",
    "metricPurpose": "VPN权限授权率、拒绝率、授权耗时、授权→连接转化",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；连接流程开始前生成"
      },
      {
        "name": "permission_status",
        "displayName": "权限状态",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；granted/denied/not_required/error"
      },
      {
        "name": "permission_source",
        "displayName": "权限触发来源",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；manual_connect/auto_connect/settings/retry"
      },
      {
        "name": "duration_ms",
        "displayName": "权限耗时",
        "dataType": "int",
        "reportingMode": "P2｜每次触发",
        "description": "可选；弹窗触发至结果毫秒"
      }
    ]
  },
  {
    "id": "V18-EVT-058",
    "module": "VPN业务",
    "standardEventName": "vpn_connection_result",
    "displayName": "VPN连接结果",
    "analysisGoal": "判断核心功能完成率、连接耗时及连接成功后广告机会覆盖。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "VPN连接状态机最终成功/失败/禁止回调。",
    "triggerTiming": "每个connection_id仅一个终态。",
    "metricPurpose": "连接成功率、连接耗时、连接→广告机会率",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "connection_id",
        "displayName": "连接ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；单次连接尝试唯一ID"
      },
      {
        "name": "vpn_status",
        "displayName": "连接结果",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；success/failed/prohibited"
      },
      {
        "name": "trigger_type",
        "displayName": "触发类型",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；connect/retry/auto_reconnect/timeout_disconnect/traffic_limit_disconnect"
      },
      {
        "name": "node_region",
        "displayName": "节点地区",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；国家或地区代码"
      },
      {
        "name": "duration_ms",
        "displayName": "连接耗时",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；开始到终态毫秒"
      },
      {
        "name": "error_code",
        "displayName": "失败错误码",
        "dataType": "str",
        "reportingMode": "P0｜失败触发",
        "description": "条件必传；稳定业务错误码"
      },
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联vpn_connection_start"
      },
      {
        "name": "server_id",
        "displayName": "节点ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；内部稳定ID"
      },
      {
        "name": "protocol",
        "displayName": "VPN协议",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；引用vpn_protocol枚举"
      },
      {
        "name": "transport",
        "displayName": "传输层",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；引用vpn_transport枚举"
      },
      {
        "name": "retry_index",
        "displayName": "重试序号",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；同一会话内序号"
      },
      {
        "name": "fallback_index",
        "displayName": "回退序号",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；协议/端口/节点回退序号"
      },
      {
        "name": "error_stage",
        "displayName": "失败阶段",
        "dataType": "str",
        "reportingMode": "P1｜失败触发",
        "description": "条件必传；标准phase_name；成功省略"
      },
      {
        "name": "error_category",
        "displayName": "错误分类",
        "dataType": "str",
        "reportingMode": "P1｜失败触发",
        "description": "条件必传；引用vpn_error_category枚举"
      }
    ]
  },
  {
    "id": "V18-EVT-059",
    "module": "VPN业务",
    "standardEventName": "vpn_disconnection",
    "displayName": "VPN断开结果",
    "analysisGoal": "统计主动断开、异常断开、使用时长和流量。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "VPN Service断开终态回调。",
    "triggerTiming": "每次有效连接结束。",
    "metricPurpose": "连接时长、断开原因、流量、稳定性",
    "sourceAlias": "原完整变现规范",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "connection_id",
        "displayName": "连接ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；关联连接"
      },
      {
        "name": "disconnect_reason",
        "displayName": "断开原因",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；user/network_error/server_error/timeout/traffic_limit/app_killed/unknown"
      },
      {
        "name": "connected_duration_ms",
        "displayName": "连接时长",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；成功连接到断开毫秒"
      },
      {
        "name": "traffic_bytes",
        "displayName": "使用流量",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；上下行合计字节数"
      },
      {
        "name": "node_region",
        "displayName": "节点地区",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；国家或地区代码"
      },
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联当前VPN会话"
      },
      {
        "name": "server_id",
        "displayName": "节点ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；内部稳定ID"
      },
      {
        "name": "protocol",
        "displayName": "VPN协议",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；引用vpn_protocol枚举"
      },
      {
        "name": "transport",
        "displayName": "传输层",
        "dataType": "str",
        "reportingMode": "P2｜每次触发",
        "description": "可选；引用vpn_transport枚举"
      },
      {
        "name": "network_type",
        "displayName": "断开时网络类型",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；wifi/cellular/ethernet/none/unknown"
      },
      {
        "name": "reconnect_count",
        "displayName": "重连次数",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；断开前累计"
      },
      {
        "name": "network_change_count",
        "displayName": "网络切换次数",
        "dataType": "int",
        "reportingMode": "P2｜每次触发",
        "description": "可选；会话累计"
      },
      {
        "name": "last_quality_status",
        "displayName": "断开前质量等级",
        "dataType": "str",
        "reportingMode": "P2｜有质量样本时",
        "description": "可选；good/fair/poor/unusable/unknown"
      }
    ]
  },
  {
    "id": "V18-EVT-060",
    "module": "VPN诊断",
    "standardEventName": "vpn_network_diagnostic",
    "displayName": "VPN网络专项诊断",
    "analysisGoal": "在连续失败或用户主动诊断时识别DNS污染、UDP/QUIC阻断、TCP Reset、TLS拦截、限速和MTU问题。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "VPN诊断模块；只针对公司自有/允许目标，禁止采集用户访问域名。",
    "triggerTiming": "连续连接失败、异常断开、手动诊断或灰度抽样时；默认不对全部用户高频运行。",
    "metricPurpose": "限制类型分布、国家/ASN/协议失败矩阵、可行回退策略",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P1｜会话内触发",
        "description": "条件必传；可关联时必传"
      },
      {
        "name": "diagnostic_id",
        "displayName": "诊断ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；UUID"
      },
      {
        "name": "test_type",
        "displayName": "诊断类型",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；dns/tcp/tls/udp/quic/http/mtu"
      },
      {
        "name": "target_id",
        "displayName": "诊断目标ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；内部allowlist ID；禁止原始域名/IP"
      },
      {
        "name": "result_status",
        "displayName": "诊断结果",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；success/failed/timeout/inconclusive"
      },
      {
        "name": "duration_ms",
        "displayName": "诊断耗时",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；整数毫秒"
      },
      {
        "name": "error_code",
        "displayName": "诊断错误码",
        "dataType": "str",
        "reportingMode": "P1｜失败触发",
        "description": "条件必传；稳定机器码"
      },
      {
        "name": "restriction_signal",
        "displayName": "网络限制信号",
        "dataType": "str",
        "reportingMode": "P1｜可判断时",
        "description": "条件必传；引用network_restriction_type枚举；推断结果不是绝对事实"
      },
      {
        "name": "ip_family",
        "displayName": "IP协议族",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；ipv4/ipv6/dual/unknown"
      },
      {
        "name": "detected_mtu",
        "displayName": "探测MTU",
        "dataType": "int",
        "reportingMode": "P2｜MTU诊断可得时",
        "description": "可选；有效整数"
      },
      {
        "name": "clock_skew_ms",
        "displayName": "设备时间偏差",
        "dataType": "int",
        "reportingMode": "P2｜TLS诊断可得时",
        "description": "可选；根据受控服务Date头估算，不上传设备本地时间明文"
      }
    ]
  },
  {
    "id": "V18-EVT-061",
    "module": "VPN质量",
    "standardEventName": "vpn_quality_sample",
    "displayName": "VPN连接质量采样",
    "analysisGoal": "持续观察连接后的延迟、抖动、丢包和吞吐，识别连接成功但不可用。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "VPN质量采样器；Firebase低频抽样，完整高频数据进入OSS/ADB。",
    "triggerTiming": "连接10秒首采，之后建议60秒一次、每会话最多20次；异常时强制补一条。",
    "metricPurpose": "延迟/抖动/丢包P50/P95、弱网会话占比、协议/节点质量趋势",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；关联当前VPN会话"
      },
      {
        "name": "connection_id",
        "displayName": "连接尝试ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；产生当前隧道的connection_id"
      },
      {
        "name": "sample_reason",
        "displayName": "采样原因",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；initial/periodic/network_change/error/disconnect"
      },
      {
        "name": "sample_seq",
        "displayName": "采样序号",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；会话内从1递增"
      },
      {
        "name": "latency_ms",
        "displayName": "延迟",
        "dataType": "int",
        "reportingMode": "P1｜可得时",
        "description": "可选；整数毫秒"
      },
      {
        "name": "jitter_ms",
        "displayName": "抖动",
        "dataType": "int",
        "reportingMode": "P2｜可得时",
        "description": "可选；整数毫秒"
      },
      {
        "name": "packet_loss_pct",
        "displayName": "丢包率",
        "dataType": "double",
        "reportingMode": "P1｜可得时",
        "description": "可选；0~100"
      },
      {
        "name": "download_kbps",
        "displayName": "下载吞吐",
        "dataType": "int",
        "reportingMode": "P2｜可得时",
        "description": "可选；估算kbps；禁止主动消耗大流量测速"
      },
      {
        "name": "upload_kbps",
        "displayName": "上传吞吐",
        "dataType": "int",
        "reportingMode": "P2｜可得时",
        "description": "可选；估算kbps"
      },
      {
        "name": "rx_bytes",
        "displayName": "累计接收字节",
        "dataType": "int",
        "reportingMode": "P2｜可得时",
        "description": "可选；会话累计"
      },
      {
        "name": "tx_bytes",
        "displayName": "累计发送字节",
        "dataType": "int",
        "reportingMode": "P2｜可得时",
        "description": "可选；会话累计"
      },
      {
        "name": "quality_status",
        "displayName": "质量等级",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；good/fair/poor/unusable/unknown；阈值由中台配置"
      }
    ]
  },
  {
    "id": "V18-EVT-062",
    "module": "VPN质量",
    "standardEventName": "vpn_session_summary",
    "displayName": "VPN会话汇总",
    "analysisGoal": "在会话结束时形成可直接分析的稳定性、质量、回退和流量摘要。",
    "platforms": "Android/iOS（按平台实现）",
    "trackingLocation": "VPN会话Context终态汇总器；断开后、进程正常退出前尽力发送。",
    "triggerTiming": "每个成功建立过隧道的vpn_session_id结束一次；同一会话只允许一个汇总终态。",
    "metricPurpose": "会话时长、异常断开率、重连/回退次数、低质量会话率、人均流量",
    "sourceAlias": "V1.8新增/补充字段",
    "priority": "P0",
    "chainKey": "vpn_session_id",
    "sourceSheets": [
      "01B_VPN功能打点"
    ],
    "parameters": [
      {
        "name": "vpn_session_id",
        "displayName": "VPN会话ID",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；会话唯一ID"
      },
      {
        "name": "connection_id",
        "displayName": "最终连接尝试ID",
        "dataType": "str",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；最终成功连接的connection_id"
      },
      {
        "name": "connected_duration_ms",
        "displayName": "连接时长",
        "dataType": "int",
        "reportingMode": "P0｜每次触发",
        "description": "必传；隧道ready至断开毫秒"
      },
      {
        "name": "disconnect_reason",
        "displayName": "断开原因",
        "dataType": "str",
        "reportingMode": "P0｜每次触发",
        "description": "必传；引用disconnect_reason枚举"
      },
      {
        "name": "reconnect_count",
        "displayName": "自动重连次数",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；会话内自动重连次数"
      },
      {
        "name": "fallback_count",
        "displayName": "策略回退次数",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；协议/端口/节点回退次数"
      },
      {
        "name": "network_change_count",
        "displayName": "网络切换次数",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；会话内网络变化次数"
      },
      {
        "name": "quality_sample_count",
        "displayName": "质量样本数",
        "dataType": "int",
        "reportingMode": "P2｜每次触发",
        "description": "可选；本会话有效质量样本数"
      },
      {
        "name": "avg_latency_ms",
        "displayName": "平均延迟",
        "dataType": "int",
        "reportingMode": "P2｜有样本时",
        "description": "可选；有效样本平均"
      },
      {
        "name": "p95_latency_ms",
        "displayName": "P95延迟",
        "dataType": "int",
        "reportingMode": "P2｜有样本时",
        "description": "可选；有效样本P95"
      },
      {
        "name": "avg_packet_loss_pct",
        "displayName": "平均丢包率",
        "dataType": "double",
        "reportingMode": "P2｜有样本时",
        "description": "可选；0~100"
      },
      {
        "name": "traffic_bytes",
        "displayName": "总流量",
        "dataType": "int",
        "reportingMode": "P1｜每次触发",
        "description": "条件必传；上下行合计字节"
      }
    ]
  }
];
