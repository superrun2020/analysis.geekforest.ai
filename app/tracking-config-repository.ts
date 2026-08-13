import { v17StandardEvents, v17EventSource, type V17EventParameter, type V17StandardEvent } from "./v17-event-catalog";

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
  sourceType: "database" | "local-v17-preview";
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

const toEventRow = (event: V17StandardEvent): TrackingDatabaseEventRow => ({
  eventId: event.id,
  schemaVersion: "V1.7",
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
});

const toFieldRows = (event: V17StandardEvent): TrackingDatabaseFieldRow[] =>
  event.parameters.map((parameter: V17EventParameter, index) => ({
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
export const localV17DatabaseSnapshot: TrackingDatabaseSnapshot = {
  sourceType: "local-v17-preview",
  sourceLabel: "本地 V1.7 字段镜像（待接数据库）",
  schemaVersion: "V1.7",
  databaseName: "待提供",
  eventTable: "tracking_event_specs（待确认）",
  fieldTable: "tracking_event_fields（待确认）",
  fetchedAt: "构建时生成",
  events: v17StandardEvents.map(toEventRow),
  fields: v17StandardEvents.flatMap(toFieldRows),
};

export const trackingConfigDataSource: TrackingConfigDataSource = {
  sourceType: localV17DatabaseSnapshot.sourceType,
  sourceLabel: localV17DatabaseSnapshot.sourceLabel,
  schemaVersion: localV17DatabaseSnapshot.schemaVersion,
  databaseName: localV17DatabaseSnapshot.databaseName,
  eventTable: localV17DatabaseSnapshot.eventTable,
  fieldTable: localV17DatabaseSnapshot.fieldTable,
  fetchedAt: localV17DatabaseSnapshot.fetchedAt,
  eventCount: localV17DatabaseSnapshot.events.length,
  fieldCount: localV17DatabaseSnapshot.fields.length,
};

export const trackingDatabaseFieldRowsForEvent = (eventId: string) =>
  localV17DatabaseSnapshot.fields.filter((field) => field.eventId === eventId);

export const trackingDatabaseEventRows = localV17DatabaseSnapshot.events;
export const trackingDatabaseFieldRows = localV17DatabaseSnapshot.fields;

export const trackingDatabaseSource = {
  ...v17EventSource,
  ...trackingConfigDataSource,
};
