import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1708272000000 implements MigrationInterface {
  name = 'InitialSchema1708272000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "username" VARCHAR(50) UNIQUE NOT NULL,
        "email" VARCHAR(100) UNIQUE NOT NULL,
        "password" VARCHAR(255) NOT NULL,
        "role" VARCHAR(20) DEFAULT 'user',
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "sessions" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "title" VARCHAR(200) NOT NULL,
        "owner_id" UUID REFERENCES "users"("id"),
        "participants" TEXT[] DEFAULT '{}',
        "status" VARCHAR(20) DEFAULT 'active',
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        "last_message_at" TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "messages" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "session_id" UUID REFERENCES "sessions"("id") ON DELETE CASCADE,
        "user_id" UUID REFERENCES "users"("id"),
        "agent_id" VARCHAR(50),
        "agent_name" VARCHAR(50),
        "role" VARCHAR(20) NOT NULL,
        "content" TEXT NOT NULL,
        "mentioned_agents" TEXT[] DEFAULT '{}',
        "metadata" JSONB,
        "created_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`CREATE INDEX "idx_messages_session_id" ON "messages"("session_id");`);
    await queryRunner.query(`CREATE INDEX "idx_messages_created_at" ON "messages"("created_at");`);
    await queryRunner.query(`CREATE INDEX "idx_sessions_owner_id" ON "sessions"("owner_id");`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_sessions_owner_id";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_messages_created_at";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_messages_session_id";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "messages";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sessions";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users";`);
  }
}
