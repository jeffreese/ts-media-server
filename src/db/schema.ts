import { sqliteTable, text, integer, blob, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Core Media Tables
// ---------------------------------------------------------------------------

export const host = sqliteTable('host', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name'),
  description: text('description'),
  metadata: text('metadata', { mode: 'json' }),
});

export const path = sqliteTable('path', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dir: text('dir').notNull(),
  hostId: integer('host_id').notNull().references(() => host.id),
}, (table) => [
  uniqueIndex('path_dir_host_idx').on(table.dir, table.hostId),
]);

export const file = sqliteTable('file', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  extension: text('extension'),
  pathId: integer('path_id').notNull().references(() => path.id),
  type: text('type'),
  date: text('date'),
  size: integer('size'),
  hash: text('hash'),
  metadata: text('metadata', { mode: 'json' }),
}, (table) => [
  uniqueIndex('file_path_name_ext_idx').on(table.pathId, table.name, table.extension),
]);

export const mediaItem = sqliteTable('media_item', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name'),
  description: text('description'),
  type: text('type'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  hash: text('hash'),
  info: text('info', { mode: 'json' }),
});

export const mediaItemFile = sqliteTable('media_item_file', {
  mediaItemId: integer('media_item_id').notNull().references(() => mediaItem.id, { onDelete: 'cascade' }),
  fileId: integer('file_id').notNull().references(() => file.id, { onDelete: 'cascade' }),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
}, (table) => [
  uniqueIndex('media_item_file_idx').on(table.mediaItemId, table.fileId),
]);

export const keyword = sqliteTable('keyword', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  word: text('word').notNull().unique(),
});

export const mediaItemKeyword = sqliteTable('media_item_keyword', {
  mediaItemId: integer('media_item_id').notNull().references(() => mediaItem.id, { onDelete: 'cascade' }),
  keywordId: integer('keyword_id').notNull().references(() => keyword.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('media_item_keyword_idx').on(table.mediaItemId, table.keywordId),
]);

export const mediaMatch = sqliteTable('media_match', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaItemId: integer('media_item_id').notNull().references(() => mediaItem.id, { onDelete: 'cascade' }),
  matchingItemId: integer('matching_item_id').notNull().references(() => mediaItem.id, { onDelete: 'cascade' }),
  matchInfo: text('match_info', { mode: 'json' }),
  ignoreMatch: integer('ignore_match', { mode: 'boolean' }).notNull().default(false),
});

export const mediaAccess = sqliteTable('media_access', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => mediaItem.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => userGroup.id, { onDelete: 'cascade' }),
  readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(false),
});

export const mediaLog = sqliteTable('media_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => mediaItem.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => user.id),
  date: text('date').notNull(),
  action: text('action').notNull(),
});

export const folder = sqliteTable('folder', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  parentId: integer('parent_id').references((): AnySQLiteColumn => folder.id),
  info: text('info', { mode: 'json' }),
}, (table) => [
  uniqueIndex('folder_name_parent_idx').on(table.name, table.parentId),
]);

export const folderEntry = sqliteTable('folder_entry', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  folderId: integer('folder_id').notNull().references(() => folder.id, { onDelete: 'cascade' }),
  itemId: integer('item_id').notNull().references(() => mediaItem.id, { onDelete: 'cascade' }),
  index: integer('index'),
  info: text('info', { mode: 'json' }),
}, (table) => [
  uniqueIndex('folder_entry_folder_item_idx').on(table.folderId, table.itemId),
]);

// ---------------------------------------------------------------------------
// Feature / Face Tables
// ---------------------------------------------------------------------------

export const feature = sqliteTable('feature', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => mediaItem.id, { onDelete: 'cascade' }),
  coordinates: text('coordinates', { mode: 'json' }),
  thumbnail: blob('thumbnail'),
  label: text('label'),
  info: text('info', { mode: 'json' }),
});

export const featureMatch = sqliteTable('feature_match', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  featureId: integer('feature_id').notNull().references(() => feature.id, { onDelete: 'cascade' }),
  matchingFeatureId: integer('matching_feature_id').notNull().references(() => feature.id, { onDelete: 'cascade' }),
  matchInfo: text('match_info', { mode: 'json' }),
  ignoreMatch: integer('ignore_match', { mode: 'boolean' }).notNull().default(false),
});

// ---------------------------------------------------------------------------
// People / Places Tables
// ---------------------------------------------------------------------------

export const person = sqliteTable('person', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gender: text('gender'),
  birthday: text('birthday'),
  info: text('info', { mode: 'json' }),
});

export const personName = sqliteTable('person_name', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id').notNull().references(() => person.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  preferred: integer('preferred', { mode: 'boolean' }).notNull().default(false),
  info: text('info', { mode: 'json' }),
});

export const personAddress = sqliteTable('person_address', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  addressId: integer('address_id').notNull().references(() => address.id, { onDelete: 'cascade' }),
  personId: integer('person_id').notNull().references(() => person.id, { onDelete: 'cascade' }),
  type: text('type'),
  preferred: integer('preferred', { mode: 'boolean' }).notNull().default(false),
  info: text('info', { mode: 'json' }),
});

export const personContact = sqliteTable('person_contact', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id').notNull().references(() => person.id, { onDelete: 'cascade' }),
  contact: text('contact').notNull(),
  type: text('type'),
  info: text('info', { mode: 'json' }),
});

export const personFeature = sqliteTable('person_feature', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  featureId: integer('feature_id').notNull().references(() => feature.id, { onDelete: 'cascade' }),
  personId: integer('person_id').notNull().references(() => person.id, { onDelete: 'cascade' }),
  info: text('info', { mode: 'json' }),
});

export const place = sqliteTable('place', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  info: text('info', { mode: 'json' }),
});

export const placeName = sqliteTable('place_name', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  placeId: integer('place_id').notNull().references(() => place.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  preferred: integer('preferred', { mode: 'boolean' }).notNull().default(false),
  info: text('info', { mode: 'json' }),
});

export const placeMedia = sqliteTable('place_media', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaId: integer('media_id').notNull().references(() => mediaItem.id, { onDelete: 'cascade' }),
  placeId: integer('place_id').notNull().references(() => place.id, { onDelete: 'cascade' }),
  info: text('info', { mode: 'json' }),
});

export const address = sqliteTable('address', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  street: text('street'),
  city: text('city'),
  state: text('state'),
  postalCode: text('postal_code'),
  searchTerm: text('search_term'),
  placeId: integer('place_id').references(() => place.id),
});

// ---------------------------------------------------------------------------
// User Management Tables
// ---------------------------------------------------------------------------

export const user = sqliteTable('user', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: integer('person_id').references(() => person.id),
  status: text('status'),
});

export const userAccess = sqliteTable('user_access', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  componentId: integer('component_id').notNull().references(() => component.id),
  level: integer('level').notNull().default(0),
  info: text('info', { mode: 'json' }),
});

export const userAuthentication = sqliteTable('user_authentication', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  service: text('service').notNull(),
  key: text('key').notNull(),
  value: text('value'),
  info: text('info', { mode: 'json' }),
});

export const userPreference = sqliteTable('user_preference', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value'),
});

export const userActivity = sqliteTable('user_activity', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  hour: integer('hour').notNull(),
  minute: integer('minute').notNull(),
  count: integer('count').notNull().default(0),
});

export const userRating = sqliteTable('user_rating', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  itemId: integer('item_id').notNull().references(() => mediaItem.id, { onDelete: 'cascade' }),
  date: text('date'),
  rating: integer('rating'),
  comment: text('comment'),
});

export const userGroup = sqliteTable('user_group', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
});

export const userGroupUser = sqliteTable('user_group_user', {
  userGroupId: integer('user_group_id').notNull().references(() => userGroup.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
}, (table) => [
  uniqueIndex('user_group_user_idx').on(table.userGroupId, table.userId),
]);

// ---------------------------------------------------------------------------
// System Tables
// ---------------------------------------------------------------------------

export const component = sqliteTable('component', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  label: text('label'),
  description: text('description'),
  info: text('info', { mode: 'json' }),
});

export const setting = sqliteTable('setting', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  value: text('value'),
});

export const datatype = sqliteTable('datatype', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull(),
});

export const data = sqliteTable('data', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name'),
  description: text('description'),
  typeId: integer('type_id').notNull().references(() => datatype.id),
  data: text('data', { mode: 'json' }),
  date: text('date'),
  thumbnail: blob('thumbnail'),
});

export const dataAccess = sqliteTable('data_access', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  datasetId: integer('dataset_id').notNull().references(() => data.id, { onDelete: 'cascade' }),
  groupId: integer('group_id').notNull().references(() => userGroup.id, { onDelete: 'cascade' }),
  readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(false),
});

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const hostRelations = relations(host, ({ many }) => ({
  paths: many(path),
}));

export const pathRelations = relations(path, ({ one, many }) => ({
  host: one(host, { fields: [path.hostId], references: [host.id] }),
  files: many(file),
}));

export const fileRelations = relations(file, ({ one, many }) => ({
  path: one(path, { fields: [file.pathId], references: [path.id] }),
  mediaItemFiles: many(mediaItemFile),
}));

export const mediaItemRelations = relations(mediaItem, ({ many }) => ({
  mediaItemFiles: many(mediaItemFile),
  mediaItemKeywords: many(mediaItemKeyword),
  features: many(feature),
  folderEntries: many(folderEntry),
  mediaMatches: many(mediaMatch, { relationName: 'sourceMatches' }),
  matchedBy: many(mediaMatch, { relationName: 'targetMatches' }),
  mediaAccess: many(mediaAccess),
  mediaLogs: many(mediaLog),
  placeMedia: many(placeMedia),
  userRatings: many(userRating),
}));

export const mediaItemFileRelations = relations(mediaItemFile, ({ one }) => ({
  mediaItem: one(mediaItem, { fields: [mediaItemFile.mediaItemId], references: [mediaItem.id] }),
  file: one(file, { fields: [mediaItemFile.fileId], references: [file.id] }),
}));

export const keywordRelations = relations(keyword, ({ many }) => ({
  mediaItemKeywords: many(mediaItemKeyword),
}));

export const mediaItemKeywordRelations = relations(mediaItemKeyword, ({ one }) => ({
  mediaItem: one(mediaItem, { fields: [mediaItemKeyword.mediaItemId], references: [mediaItem.id] }),
  keyword: one(keyword, { fields: [mediaItemKeyword.keywordId], references: [keyword.id] }),
}));

export const mediaMatchRelations = relations(mediaMatch, ({ one }) => ({
  mediaItem: one(mediaItem, { fields: [mediaMatch.mediaItemId], references: [mediaItem.id], relationName: 'sourceMatches' }),
  matchingItem: one(mediaItem, { fields: [mediaMatch.matchingItemId], references: [mediaItem.id], relationName: 'targetMatches' }),
}));

export const mediaAccessRelations = relations(mediaAccess, ({ one }) => ({
  mediaItem: one(mediaItem, { fields: [mediaAccess.itemId], references: [mediaItem.id] }),
  group: one(userGroup, { fields: [mediaAccess.groupId], references: [userGroup.id] }),
}));

export const mediaLogRelations = relations(mediaLog, ({ one }) => ({
  mediaItem: one(mediaItem, { fields: [mediaLog.itemId], references: [mediaItem.id] }),
  user: one(user, { fields: [mediaLog.userId], references: [user.id] }),
}));

export const folderRelations = relations(folder, ({ one, many }) => ({
  parent: one(folder, { fields: [folder.parentId], references: [folder.id], relationName: 'parentChild' }),
  children: many(folder, { relationName: 'parentChild' }),
  entries: many(folderEntry),
}));

export const folderEntryRelations = relations(folderEntry, ({ one }) => ({
  folder: one(folder, { fields: [folderEntry.folderId], references: [folder.id] }),
  mediaItem: one(mediaItem, { fields: [folderEntry.itemId], references: [mediaItem.id] }),
}));

export const featureRelations = relations(feature, ({ one, many }) => ({
  mediaItem: one(mediaItem, { fields: [feature.itemId], references: [mediaItem.id] }),
  featureMatches: many(featureMatch, { relationName: 'sourceFeatureMatches' }),
  matchedBy: many(featureMatch, { relationName: 'targetFeatureMatches' }),
  personFeatures: many(personFeature),
}));

export const featureMatchRelations = relations(featureMatch, ({ one }) => ({
  feature: one(feature, { fields: [featureMatch.featureId], references: [feature.id], relationName: 'sourceFeatureMatches' }),
  matchingFeature: one(feature, { fields: [featureMatch.matchingFeatureId], references: [feature.id], relationName: 'targetFeatureMatches' }),
}));

export const personRelations = relations(person, ({ many }) => ({
  names: many(personName),
  addresses: many(personAddress),
  contacts: many(personContact),
  features: many(personFeature),
  users: many(user),
}));

export const personNameRelations = relations(personName, ({ one }) => ({
  person: one(person, { fields: [personName.personId], references: [person.id] }),
}));

export const personAddressRelations = relations(personAddress, ({ one }) => ({
  address: one(address, { fields: [personAddress.addressId], references: [address.id] }),
  person: one(person, { fields: [personAddress.personId], references: [person.id] }),
}));

export const personContactRelations = relations(personContact, ({ one }) => ({
  person: one(person, { fields: [personContact.personId], references: [person.id] }),
}));

export const personFeatureRelations = relations(personFeature, ({ one }) => ({
  feature: one(feature, { fields: [personFeature.featureId], references: [feature.id] }),
  person: one(person, { fields: [personFeature.personId], references: [person.id] }),
}));

export const placeRelations = relations(place, ({ many }) => ({
  names: many(placeName),
  placeMedia: many(placeMedia),
  addresses: many(address),
}));

export const placeNameRelations = relations(placeName, ({ one }) => ({
  place: one(place, { fields: [placeName.placeId], references: [place.id] }),
}));

export const placeMediaRelations = relations(placeMedia, ({ one }) => ({
  mediaItem: one(mediaItem, { fields: [placeMedia.mediaId], references: [mediaItem.id] }),
  place: one(place, { fields: [placeMedia.placeId], references: [place.id] }),
}));

export const addressRelations = relations(address, ({ one, many }) => ({
  place: one(place, { fields: [address.placeId], references: [place.id] }),
  personAddresses: many(personAddress),
}));

export const userRelations = relations(user, ({ one, many }) => ({
  person: one(person, { fields: [user.personId], references: [person.id] }),
  access: many(userAccess),
  authentications: many(userAuthentication),
  preferences: many(userPreference),
  activities: many(userActivity),
  ratings: many(userRating),
  mediaLogs: many(mediaLog),
  groupMemberships: many(userGroupUser),
}));

export const userAccessRelations = relations(userAccess, ({ one }) => ({
  user: one(user, { fields: [userAccess.userId], references: [user.id] }),
  component: one(component, { fields: [userAccess.componentId], references: [component.id] }),
}));

export const userAuthenticationRelations = relations(userAuthentication, ({ one }) => ({
  user: one(user, { fields: [userAuthentication.userId], references: [user.id] }),
}));

export const userPreferenceRelations = relations(userPreference, ({ one }) => ({
  user: one(user, { fields: [userPreference.userId], references: [user.id] }),
}));

export const userActivityRelations = relations(userActivity, ({ one }) => ({
  user: one(user, { fields: [userActivity.userId], references: [user.id] }),
}));

export const userRatingRelations = relations(userRating, ({ one }) => ({
  user: one(user, { fields: [userRating.userId], references: [user.id] }),
  mediaItem: one(mediaItem, { fields: [userRating.itemId], references: [mediaItem.id] }),
}));

export const userGroupRelations = relations(userGroup, ({ many }) => ({
  members: many(userGroupUser),
  mediaAccess: many(mediaAccess),
  dataAccess: many(dataAccess),
}));

export const userGroupUserRelations = relations(userGroupUser, ({ one }) => ({
  group: one(userGroup, { fields: [userGroupUser.userGroupId], references: [userGroup.id] }),
  user: one(user, { fields: [userGroupUser.userId], references: [user.id] }),
}));

export const componentRelations = relations(component, ({ many }) => ({
  userAccess: many(userAccess),
}));

export const datatypeRelations = relations(datatype, ({ many }) => ({
  data: many(data),
}));

export const dataRelations = relations(data, ({ one, many }) => ({
  type: one(datatype, { fields: [data.typeId], references: [datatype.id] }),
  access: many(dataAccess),
}));

export const dataAccessRelations = relations(dataAccess, ({ one }) => ({
  dataset: one(data, { fields: [dataAccess.datasetId], references: [data.id] }),
  group: one(userGroup, { fields: [dataAccess.groupId], references: [userGroup.id] }),
}));
