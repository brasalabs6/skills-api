export type Env = {
  DB: D1Database;
  ASSETS: R2Bucket;
  AI: Ai;
  EVENT_QUEUE: Queue<{event_id:string}>;
  APP_ENV: string;
  AI_MODEL: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  WEBHOOK_ENCRYPTION_KEY?: string;
  BOOTSTRAP_ADMIN_EMAIL?: string;
};
export type Principal = {kind:"human"|"service"; id:string; workspace_id:string; organization_id:string; role:string; email?:string; scopes?:string[]};
export type Vars = {Bindings:Env; Variables:{principal:Principal; requestId:string}};
