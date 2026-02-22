import 'dotenv/config';
import { DataSource } from 'typeorm';
import { MessageEntity, SessionEntity, UserEntity } from './entities';

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env: ${key}`);
  }
  return value;
}

export default new DataSource({
  type: 'postgres',
  host: getEnvOrThrow('DB_HOST'),
  port: Number(getEnvOrThrow('DB_PORT')),
  username: getEnvOrThrow('DB_USERNAME'),
  password: getEnvOrThrow('DB_PASSWORD'),
  database: getEnvOrThrow('DB_DATABASE'),
  synchronize: false,
  logging: getEnvOrThrow('DB_LOGGING') === 'true',
  entities: [UserEntity, SessionEntity, MessageEntity],
  migrations: ['src/database/migrations/*.ts'],
});
