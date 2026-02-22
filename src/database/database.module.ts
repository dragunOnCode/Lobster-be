import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageEntity, SessionEntity, UserEntity } from './entities';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        host: configService.getOrThrow<string>('DB_HOST'),
        port: Number(configService.getOrThrow<string>('DB_PORT')),
        username: configService.getOrThrow<string>('DB_USERNAME'),
        password: configService.getOrThrow<string>('DB_PASSWORD'),
        database: configService.getOrThrow<string>('DB_DATABASE'),
        synchronize: configService.getOrThrow<string>('DB_SYNCHRONIZE') === 'true',
        logging: configService.getOrThrow<string>('DB_LOGGING') === 'true',
        entities: [UserEntity, SessionEntity, MessageEntity],
        migrations: ['dist/database/migrations/*.js'],
      }),
    }),
    TypeOrmModule.forFeature([UserEntity, SessionEntity, MessageEntity]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
