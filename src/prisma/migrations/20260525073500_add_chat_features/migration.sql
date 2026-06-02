-- AlterTable
ALTER TABLE `channels` ADD COLUMN `dm_key` VARCHAR(100) NULL;

-- CreateTable
CREATE TABLE `message_reads` (
    `id` VARCHAR(36) NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `channel_id` VARCHAR(36) NOT NULL,
    `last_read_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `message_reads_user_id_channel_id_key`(`user_id`, `channel_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `channels_dm_key_key` ON `channels`(`dm_key`);

-- AddForeignKey
ALTER TABLE `message_reads` ADD CONSTRAINT `message_reads_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `message_reads` ADD CONSTRAINT `message_reads_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `channels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
