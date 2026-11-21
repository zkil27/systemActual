-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "lastWaveSlot" TEXT,
ADD COLUMN     "waveTimes" TEXT NOT NULL DEFAULT '08:30,12:30,15:30',
ADD COLUMN     "wavesAutoEnabled" BOOLEAN NOT NULL DEFAULT false;
