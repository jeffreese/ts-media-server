CREATE TABLE `address` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`street` text,
	`city` text,
	`state` text,
	`postal_code` text,
	`search_term` text,
	`place_id` integer,
	FOREIGN KEY (`place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `component` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text,
	`description` text,
	`info` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `component_key_unique` ON `component` (`key`);--> statement-breakpoint
CREATE TABLE `data` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`description` text,
	`type_id` integer NOT NULL,
	`data` text,
	`date` text,
	`thumbnail` blob,
	FOREIGN KEY (`type_id`) REFERENCES `datatype`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `data_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dataset_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`read_only` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `data`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `datatype` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feature` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`coordinates` text,
	`thumbnail` blob,
	`label` text,
	`info` text,
	FOREIGN KEY (`item_id`) REFERENCES `media_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feature_match` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feature_id` integer NOT NULL,
	`matching_feature_id` integer NOT NULL,
	`match_info` text,
	`ignore_match` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`feature_id`) REFERENCES `feature`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matching_feature_id`) REFERENCES `feature`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `file` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`extension` text,
	`path_id` integer NOT NULL,
	`type` text,
	`date` text,
	`size` integer,
	`hash` text,
	`metadata` text,
	FOREIGN KEY (`path_id`) REFERENCES `path`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_path_name_ext_idx` ON `file` (`path_id`,`name`,`extension`);--> statement-breakpoint
CREATE TABLE `folder` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`parent_id` integer,
	`info` text,
	FOREIGN KEY (`parent_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folder_name_parent_idx` ON `folder` (`name`,`parent_id`);--> statement-breakpoint
CREATE TABLE `folder_entry` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`folder_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`index` integer,
	`info` text,
	FOREIGN KEY (`folder_id`) REFERENCES `folder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `media_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `folder_entry_folder_item_idx` ON `folder_entry` (`folder_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `host` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`description` text,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `keyword` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`word` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keyword_word_unique` ON `keyword` (`word`);--> statement-breakpoint
CREATE TABLE `media_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	`read_only` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `media_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `user_group`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `media_item` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text,
	`description` text,
	`type` text,
	`start_date` text,
	`end_date` text,
	`hash` text,
	`info` text
);
--> statement-breakpoint
CREATE TABLE `media_item_file` (
	`media_item_id` integer NOT NULL,
	`file_id` integer NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_item_file_idx` ON `media_item_file` (`media_item_id`,`file_id`);--> statement-breakpoint
CREATE TABLE `media_item_keyword` (
	`media_item_id` integer NOT NULL,
	`keyword_id` integer NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`keyword_id`) REFERENCES `keyword`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_item_keyword_idx` ON `media_item_keyword` (`media_item_id`,`keyword_id`);--> statement-breakpoint
CREATE TABLE `media_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`date` text NOT NULL,
	`action` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `media_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `media_match` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_item_id` integer NOT NULL,
	`matching_item_id` integer NOT NULL,
	`match_info` text,
	`ignore_match` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matching_item_id`) REFERENCES `media_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `path` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dir` text NOT NULL,
	`host_id` integer NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `host`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `path_dir_host_idx` ON `path` (`dir`,`host_id`);--> statement-breakpoint
CREATE TABLE `person` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gender` text,
	`birthday` text,
	`info` text
);
--> statement-breakpoint
CREATE TABLE `person_address` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`address_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`type` text,
	`preferred` integer DEFAULT false NOT NULL,
	`info` text,
	FOREIGN KEY (`address_id`) REFERENCES `address`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `person_contact` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`contact` text NOT NULL,
	`type` text,
	`info` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `person_feature` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feature_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`info` text,
	FOREIGN KEY (`feature_id`) REFERENCES `feature`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `person_name` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer NOT NULL,
	`name` text NOT NULL,
	`preferred` integer DEFAULT false NOT NULL,
	`info` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `place` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`info` text
);
--> statement-breakpoint
CREATE TABLE `place_media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`place_id` integer NOT NULL,
	`info` text,
	FOREIGN KEY (`media_id`) REFERENCES `media_item`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `place_name` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`place_id` integer NOT NULL,
	`name` text NOT NULL,
	`preferred` integer DEFAULT false NOT NULL,
	`info` text,
	FOREIGN KEY (`place_id`) REFERENCES `place`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `setting` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `setting_key_unique` ON `setting` (`key`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`person_id` integer,
	`status` text,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_access` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`component_id` integer NOT NULL,
	`level` integer DEFAULT 0 NOT NULL,
	`info` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_id`) REFERENCES `component`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `user_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`hour` integer NOT NULL,
	`minute` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_authentication` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`service` text NOT NULL,
	`key` text NOT NULL,
	`value` text,
	`info` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_group` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE TABLE `user_group_user` (
	`user_group_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_group_id`) REFERENCES `user_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_group_user_idx` ON `user_group_user` (`user_group_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `user_preference` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_rating` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`date` text,
	`rating` integer,
	`comment` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `media_item`(`id`) ON UPDATE no action ON DELETE cascade
);
