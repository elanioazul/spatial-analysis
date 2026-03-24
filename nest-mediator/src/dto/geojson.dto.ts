import { IsEnum, IsArray, IsNotEmpty, ValidateNested } from 'class-validator';

export enum GeoJsonType {
  Point = 'Point',
  LineString = 'LineString',
  Polygon = 'Polygon',
  MultiPoint = 'MultiPoint',
  MultiLineString = 'MultiLineString',
  MultiPolygon = 'MultiPolygon',
}

export class GeoJsonDto {
  @IsEnum(GeoJsonType, { message: 'Invalid or unsupported GeoJSON type' })
  @IsNotEmpty()
  type: GeoJsonType;

  @IsArray()
  @IsNotEmpty()
  coordinates: any[]; 
}