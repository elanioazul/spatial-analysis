import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
//import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from 'pg';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: 'PG_CLIENT',
      useFactory: async () => {
        const client = new Client({
          host: process.env.DATABASE_HOST,
          port: +process.env.DATABASE_PORT,
          user: process.env.DATABASE_USER,
          password: process.env.DATABASE_PASSWORD,
          database: process.env.DATABASE_NAME
        });
        await client.connect();
        return client;
      },
    },
  ],
})
export class AppModule { }
