import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChromaService } from './services/chroma.service';
import { EmbeddingService } from './services/embedding.service';

@Module({
  imports: [ConfigModule],
  providers: [EmbeddingService, ChromaService],
  exports: [EmbeddingService, ChromaService],
})
export class VectorModule {}
