-- Store the maximum achievable score per attempt so results can display "Score: X / Y".
ALTER TABLE "attempts" ADD COLUMN "maxScore" DOUBLE PRECISION;
