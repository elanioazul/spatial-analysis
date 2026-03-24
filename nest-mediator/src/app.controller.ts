import { Body, Controller, Get, ParseFloatPipe, ParseIntPipe, Post, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { GeoJsonDto } from './dto/geojson.dto';

@Controller('spatial')
export class AppController {
  constructor(private readonly appService: AppService) {}

/**
   * Endpoint for GDAL Variation
   * GET /spatial/viewshed-gdal?lat=...&lon=...&radius=...&height=...
   */
  @Get('viewshed-gdal')
  async getGdalViewshed(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lon', ParseFloatPipe) lon: number,
    @Query('radius', ParseIntPipe) radius: number,
    @Query('height', ParseIntPipe) height: number,
    @Query('rays', ParseIntPipe) rays: number,
    @Query('heading', ParseIntPipe) heading: number,
    @Query('fov', ParseIntPipe) fov: number,
  ) {
    const startTime = Date.now();
    const result = await this.appService.getViewshedGdal(lat, lon, radius, height, rays, heading, fov);
    const duration = Date.now() - startTime;

    return {
      engine: 'GDAL+ Postgis',
      executionTimeMs: duration,
      geojson: result,
    };
  }


  @Post('intersect-buildings')
  async checkIntersections(
    @Body() geojsonInput: GeoJsonDto,
  ) {
    const startTime = Date.now();
    const result = await this.appService.checkBuildingIntersection(geojsonInput);
    const duration = Date.now() - startTime;

    return {
      engine: 'PostGIS + NestJS Validation',
      executionTimeMs: duration,
      geojson: result,
    };
  }
}
