import { z } from "zod";
import { normalizeTikTokScopes } from "./readiness";
import type {
  MockTikTokScenario,
  TikTokBasicUserInfo,
  TikTokCreatorInfo,
  TikTokScope,
  TikTokTokenSet,
} from "./types";

export interface TikTokProvider {
  buildAuthorizationUrl(input: {
    clientKey: string;
    redirectUri: string;
    scopes: readonly TikTokScope[];
    state: string;
    disableAutoAuth?: boolean;
  }): string;
  exchangeAuthorizationCode(code: string): Promise<TikTokTokenSet>;
  refreshAccessToken(refreshToken: string): Promise<TikTokTokenSet>;
  revokeAuthorization(accessToken: string): Promise<void>;
  getBasicUserInfo(accessToken: string): Promise<TikTokBasicUserInfo>;
  queryCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo>;
}

const tokenResponseSchema = z.object({
  open_id: z.string().min(1),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  scope: z.string(),
  expires_in: z.number().int().positive(),
  refresh_expires_in: z.number().int().positive(),
});

const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string().optional() }).optional(),
});

const userInfoSchema = z.object({
  data: z.object({
    user: z.object({
      open_id: z.string().min(1),
      union_id: z.string().nullish(),
      display_name: z.string().min(1),
      avatar_url: z.string().url().nullish(),
    }),
  }),
  error: z.object({ code: z.literal("ok") }),
});

const creatorInfoSchema = z.object({
  data: z.object({
    creator_avatar_url: z.string().url().nullish(),
    creator_username: z.string().min(1),
    creator_nickname: z.string().min(1),
    privacy_level_options: z.array(z.string()).min(1),
    comment_disabled: z.boolean(),
    duet_disabled: z.boolean(),
    stitch_disabled: z.boolean(),
    max_video_post_duration_sec: z.number().int().positive(),
  }),
  error: z.object({ code: z.literal("ok") }),
});

function expiresAt(seconds: number, now = Date.now()) {
  return new Date(now + seconds * 1000).toISOString();
}

function tokenSet(raw: z.infer<typeof tokenResponseSchema>): TikTokTokenSet {
  return {
    openId: raw.open_id,
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    tokenType: raw.token_type,
    scopes: normalizeTikTokScopes(raw.scope.split(",").map((scope) => scope.trim())),
    accessTokenExpiresAt: expiresAt(raw.expires_in),
    refreshTokenExpiresAt: expiresAt(raw.refresh_expires_in),
  };
}

async function parseJson(response: Response) {
  const json: unknown = await response.json();
  const oauthError = z.object({ error: z.string().min(1) }).safeParse(json);
  if (oauthError.success) throw new Error(oauthError.data.error);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(json);
    throw new Error(parsed.success ? parsed.data.error?.code ?? "tiktok_api_error" : "tiktok_api_error");
  }
  return json;
}

export class OfficialTikTokProvider implements TikTokProvider {
  constructor(
    private readonly config: {
      clientKey: string;
      clientSecret: string;
      redirectUri: string;
      fetch?: typeof fetch;
    },
  ) {}

  buildAuthorizationUrl(input: {
    clientKey: string;
    redirectUri: string;
    scopes: readonly TikTokScope[];
    state: string;
    disableAutoAuth?: boolean;
  }) {
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.search = new URLSearchParams({
      client_key: input.clientKey,
      scope: [...input.scopes].join(","),
      response_type: "code",
      redirect_uri: input.redirectUri,
      state: input.state,
      ...(input.disableAutoAuth ? { disable_auto_auth: "1" } : {}),
    }).toString();
    return url.toString();
  }

  private async tokenRequest(parameters: Record<string, string>) {
    const response = await (this.config.fetch ?? fetch)(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: this.config.clientKey,
          client_secret: this.config.clientSecret,
          ...parameters,
        }),
      },
    );
    return tokenSet(tokenResponseSchema.parse(await parseJson(response)));
  }

  exchangeAuthorizationCode(code: string) {
    return this.tokenRequest({
      code,
      grant_type: "authorization_code",
      redirect_uri: this.config.redirectUri,
    });
  }

  refreshAccessToken(refreshToken: string) {
    return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  async revokeAuthorization(accessToken: string) {
    const response = await (this.config.fetch ?? fetch)(
      "https://open.tiktokapis.com/v2/oauth/revoke/",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: this.config.clientKey,
          client_secret: this.config.clientSecret,
          token: accessToken,
        }),
      },
    );
    if (!response.ok) await parseJson(response);
  }

  async getBasicUserInfo(accessToken: string) {
    const url = new URL("https://open.tiktokapis.com/v2/user/info/");
    url.searchParams.set("fields", "open_id,union_id,avatar_url,display_name");
    const response = await (this.config.fetch ?? fetch)(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const parsed = userInfoSchema.parse(await parseJson(response)).data.user;
    return {
      openId: parsed.open_id,
      unionId: parsed.union_id ?? null,
      displayName: parsed.display_name,
      avatarUrl: parsed.avatar_url ?? null,
    };
  }

  async queryCreatorInfo(accessToken: string) {
    const response = await (this.config.fetch ?? fetch)(
      "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      },
    );
    const parsed = creatorInfoSchema.parse(await parseJson(response)).data;
    return {
      username: parsed.creator_username,
      nickname: parsed.creator_nickname,
      avatarUrl: parsed.creator_avatar_url ?? null,
      privacyLevelOptions: parsed.privacy_level_options,
      commentDisabled: parsed.comment_disabled,
      duetDisabled: parsed.duet_disabled,
      stitchDisabled: parsed.stitch_disabled,
      maxVideoPostDurationSec: parsed.max_video_post_duration_sec,
    };
  }
}

const scenarioScopes: Record<MockTikTokScenario, TikTokScope[]> = {
  connected: ["user.info.basic"],
  partial: ["user.info.basic"],
  upload_ready: ["user.info.basic", "video.upload"],
  direct_ready: ["user.info.basic", "video.publish", "video.upload"],
  private_only: ["user.info.basic", "video.publish"],
  expired: ["user.info.basic", "video.publish"],
  revoked: ["user.info.basic", "video.publish"],
  creator_failure: ["user.info.basic", "video.publish"],
};

export class MockTikTokProvider implements TikTokProvider {
  constructor(private readonly scenario: MockTikTokScenario = "connected") {}

  buildAuthorizationUrl(input: {
    clientKey: string;
    redirectUri: string;
    scopes: readonly TikTokScope[];
    state: string;
  }) {
    const url = new URL(input.redirectUri);
    url.searchParams.set("code", `mock-code-${this.scenario}`);
    url.searchParams.set("state", input.state);
    return url.toString();
  }

  async exchangeAuthorizationCode() {
    const expired = this.scenario === "expired";
    const suffix = this.scenario.replaceAll("_", "-");
    return {
      openId: `mock-open-${suffix}`,
      accessToken: `mock-access-${suffix}`,
      refreshToken: `mock-refresh-${suffix}`,
      tokenType: "Bearer" as const,
      scopes: scenarioScopes[this.scenario],
      accessTokenExpiresAt: new Date(Date.now() + (expired ? -60_000 : 86_400_000)).toISOString(),
      refreshTokenExpiresAt: new Date(Date.now() + 31_536_000_000).toISOString(),
    };
  }

  async refreshAccessToken() {
    if (this.scenario === "revoked") throw new Error("access_token_invalid");
    return this.exchangeAuthorizationCode();
  }

  async revokeAuthorization() {}

  async getBasicUserInfo(): Promise<TikTokBasicUserInfo> {
    return {
      openId: `mock-open-${this.scenario.replaceAll("_", "-")}`,
      unionId: `mock-union-${this.scenario.replaceAll("_", "-")}`,
      displayName: `Mock ${this.scenario}`,
      avatarUrl: null,
    };
  }

  async queryCreatorInfo(): Promise<TikTokCreatorInfo> {
    if (this.scenario === "creator_failure") throw new Error("creator_info_unavailable");
    return {
      username: `mock.${this.scenario.replaceAll("_", ".")}`,
      nickname: `Mock ${this.scenario}`,
      avatarUrl: null,
      privacyLevelOptions: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
      commentDisabled: false,
      duetDisabled: false,
      stitchDisabled: this.scenario === "private_only",
      maxVideoPostDurationSec: 300,
    };
  }
}

export { creatorInfoSchema, tokenResponseSchema, userInfoSchema };
