CREATE TABLE `face_rejection` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`feature_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`feature_id`) REFERENCES `feature`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `person`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `face_rejection_feature_person_idx` ON `face_rejection` (`feature_id`,`person_id`);--> statement-breakpoint
CREATE INDEX `face_rejection_feature_id_idx` ON `face_rejection` (`feature_id`);--> statement-breakpoint
CREATE INDEX `face_rejection_person_id_idx` ON `face_rejection` (`person_id`);