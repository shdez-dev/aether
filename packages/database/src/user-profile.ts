import type { Pool } from "pg";

type UserProfileInput = {
  displayName: string;
  role: string;
  bio: string;
  avatarData: string | null;
};
type UserProfileResponse = UserProfileInput & { updatedAt: string | null };

type ProfileRow = {
  display_name: string | null;
  identity_name: string | null;
  role: string | null;
  bio: string | null;
  avatar_data: string | null;
  updated_at: Date | null;
};

function toResponse(row?: ProfileRow): UserProfileResponse {
  return {
    displayName: row?.display_name?.trim() || row?.identity_name || "",
    role: row?.role ?? "",
    bio: row?.bio ?? "",
    avatarData: row?.avatar_data ?? null,
    updatedAt: row?.updated_at?.toISOString() ?? null,
  };
}

export class PostgresUserProfileStore {
  constructor(private readonly pool: Pool) {}

  async getName(actorId: string): Promise<string | null> {
    const result = await this.pool.query<{
      display_name: string | null;
      identity_name: string | null;
    }>(
      `SELECT profile.display_name, identity.display_name AS identity_name
       FROM actor_identities AS identity
       LEFT JOIN user_profiles AS profile ON profile.actor_id = identity.id
       WHERE identity.id = $1`,
      [actorId],
    );
    return (
      result.rows[0]?.display_name?.trim() ||
      result.rows[0]?.identity_name?.trim() ||
      null
    );
  }

  async get(actorId: string): Promise<UserProfileResponse> {
    const result = await this.pool.query<ProfileRow>(
      `SELECT profile.display_name, identity.display_name AS identity_name,
              profile.role, profile.bio, profile.avatar_data, profile.updated_at
       FROM actor_identities AS identity
       LEFT JOIN user_profiles AS profile ON profile.actor_id = identity.id
       WHERE identity.id = $1`,
      [actorId],
    );
    return toResponse(result.rows[0]);
  }

  async save(
    actorId: string,
    profile: UserProfileInput,
  ): Promise<UserProfileResponse> {
    await this.pool.query(
      `INSERT INTO user_profiles (actor_id, display_name, role, bio, avatar_data)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (actor_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         role = EXCLUDED.role,
         bio = EXCLUDED.bio,
         avatar_data = EXCLUDED.avatar_data,
         updated_at = NOW()
       RETURNING actor_id`,
      [
        actorId,
        profile.displayName,
        profile.role,
        profile.bio,
        profile.avatarData,
      ],
    );
    return this.get(actorId);
  }
}
