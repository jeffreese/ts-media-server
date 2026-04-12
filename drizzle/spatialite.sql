-- SpatiaLite geometry columns and spatial indexes.
-- Applied by the migration runner when SpatiaLite is loaded.
-- AddGeometryColumn(table, column, srid, type, dimension)

SELECT AddGeometryColumn('media_item', 'location', 4326, 'POINT', 'XY');
SELECT CreateSpatialIndex('media_item', 'location');
SELECT AddGeometryColumn('place', 'location', 4326, 'POINT', 'XY');
SELECT CreateSpatialIndex('place', 'location');
