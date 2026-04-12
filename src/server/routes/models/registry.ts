import { type SQLiteTableWithColumns } from 'drizzle-orm/sqlite-core';
import * as schema from '../../../db/schema.js';

/**
 * Maps a camelCase model name to its Drizzle table definition.
 *
 * The model name is used as the URL segment: `GET /model/:id`, `GET /model`,
 * `POST /model`, `DELETE /model/:id`. Junction tables without an `id` primary
 * key are excluded — they are managed through their parent model's routes.
 *
 * Models with dedicated custom route handlers (e.g. `setting`) are excluded
 * to avoid route conflicts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MODEL_REGISTRY: Record<string, SQLiteTableWithColumns<any>> = {
  host: schema.host,
  path: schema.path,
  file: schema.file,
  keyword: schema.keyword,
  mediaMatch: schema.mediaMatch,
  mediaAccess: schema.mediaAccess,
  mediaLog: schema.mediaLog,
  folder: schema.folder,
  folderEntry: schema.folderEntry,
  feature: schema.feature,
  featureMatch: schema.featureMatch,
  person: schema.person,
  personName: schema.personName,
  personAddress: schema.personAddress,
  personContact: schema.personContact,
  personFeature: schema.personFeature,
  place: schema.place,
  placeName: schema.placeName,
  placeMedia: schema.placeMedia,
  address: schema.address,
  user: schema.user,
  userAccess: schema.userAccess,
  userAuthentication: schema.userAuthentication,
  userPreference: schema.userPreference,
  userActivity: schema.userActivity,
  userRating: schema.userRating,
  userGroup: schema.userGroup,
  component: schema.component,
  datatype: schema.datatype,
  data: schema.data,
  dataAccess: schema.dataAccess,
};
