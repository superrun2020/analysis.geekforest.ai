import { v18StandardEvents, v18EventSource, type V18EventParameter, type V18StandardEvent } from "./v18-event-catalog";

export type TrackingDatabaseEventRow = {
  eventId: string;
  schemaVersion: string;
  module: string;
  standardEventName: string;
  displayName: string;
  analysisGoal: string;
  platforms: string;
  trackingLocation: string;
  triggerTiming: string;
  metricPurpose: string;
  sourceAlias: string;
  provider: string;
  priority: "P0" | "P1" | "P2";
  chainKey: "session_id" | "vpn_session_id";
};

export type TrackingDatabaseFieldRow = {
  eventId: string;
  fieldOrder: number;
  fieldName: string;
  displayName: string;
  dataType: string;
  reportingMode: string;
  description: string;
};

export type TrackingDatabaseSnapshot = {
  sourceType: "database" | "local-v18-preview";
  sourceLabel: string;
  schemaVersion: string;
  databaseName: string;
  eventTable: string;
  fieldTable: string;
  fetchedAt: string;
  events: TrackingDatabaseEventRow[];
  fields: TrackingDatabaseFieldRow[];
};

export type TrackingConfigDataSource = Pick<
  TrackingDatabaseSnapshot,
  "sourceType" | "sourceLabel" | "schemaVersion" | "databaseName" | "eventTable" | "fieldTable" | "fetchedAt"
> & {
  eventCount: number;
  fieldCount: number;
};

const providerByModule: Record<string, string> = {
  "App生命周期": "LifecycleProvider",
  "页面行为": "ScreenContextProvider",
  "核心行为": "BusinessContextProvider",
  "VPN业务": "VpnContextProvider",
  "付费业务": "SubscriptionProvider",
  "隐私与SDK": "ConsentAdSdkProvider",
  "广告机会": "AdOpportunityProvider",
  "广告请求": "AdRequestProvider",
  "广告加载": "AdSdkProvider",
  "广告缓存": "AdCacheProvider",
  "广告展示": "AdPresentationProvider",
  "广告收入": "AdRevenueProvider",
  "Banner专项": "BannerVisibilityProvider",
  "接口质量": "NetworkQualityProvider",
  "上报健康": "TelemetryHealthProvider",
};

const toEventRow = (event: V18StandardEvent): TrackingDatabaseEventRow => ({
  eventId: event.id,
  schemaVersion: "V1.8",
  module: event.module,
  standardEventName: event.standardEventName,
  displayName: event.displayName,
  analysisGoal: event.analysisGoal,
  platforms: event.platforms,
  trackingLocation: event.trackingLocation,
  triggerTiming: event.triggerTiming,
  metricPurpose: event.metricPurpose,
  sourceAlias: event.sourceAlias,
  provider: providerByModule[event.module] ?? "BusinessProvider",
  priority: event.priority,
  chainKey: event.chainKey,
});

const toFieldRows = (event: V18StandardEvent): TrackingDatabaseFieldRow[] =>
  event.parameters.map((parameter: V18EventParameter, index) => ({
    eventId: event.id,
    fieldOrder: index + 1,
    fieldName: parameter.name,
    displayName: parameter.displayName,
    dataType: parameter.dataType,
    reportingMode: parameter.reportingMode,
    description: parameter.description,
  }));

// This is deliberately shaped like the future database response. When the database
// is supplied, replace this provider with an API/server loader and keep the page model stable.
export const localV18DatabaseSnapshot: TrackingDatabaseSnapshot = {
  sourceType: "local-v18-preview",
  sourceLabel: "V1.8 广告与 VPN 资格检查更新版",
  schemaVersion: "V1.8",
  databaseName: "待提供",
  eventTable: "tracking_event_specs（待确认）",
  fieldTable: "tracking_event_fields（待确认）",
  fetchedAt: "构建时生成",
  events: v18StandardEvents.map(toEventRow),
  fields: v18StandardEvents.flatMap(toFieldRows),
};

export const trackingConfigDataSource: TrackingConfigDataSource = {
  sourceType: localV18DatabaseSnapshot.sourceType,
  sourceLabel: localV18DatabaseSnapshot.sourceLabel,
  schemaVersion: localV18DatabaseSnapshot.schemaVersion,
  databaseName: localV18DatabaseSnapshot.databaseName,
  eventTable: localV18DatabaseSnapshot.eventTable,
  fieldTable: localV18DatabaseSnapshot.fieldTable,
  fetchedAt: localV18DatabaseSnapshot.fetchedAt,
  eventCount: localV18DatabaseSnapshot.events.length,
  fieldCount: localV18DatabaseSnapshot.fields.length,
};

export const trackingDatabaseFieldRowsForEvent = (eventId: string) =>
  localV18DatabaseSnapshot.fields.filter((field) => field.eventId === eventId);

export const trackingDatabaseEventRows = localV18DatabaseSnapshot.events;
export const trackingDatabaseFieldRows = localV18DatabaseSnapshot.fields;

export const trackingDatabaseSource = {
  ...v18EventSource,
  ...trackingConfigDataSource,
};
