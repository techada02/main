/**
 * Worker ranking utility
 * Calculates and updates worker rank based on points
 */

const RANK_THRESHOLDS = {
  Bronze:   0,
  Silver:   100,
  Gold:     300,
  Platinum: 600,
};

const POINT_VALUES = {
  job_completed:        10,
  five_star_rating:     15,
  four_star_rating:     8,
  on_time_arrival:      5,
  no_cancellation_bonus: 3,
  customer_badge:       20,
};

/**
 * Determine rank level based on total points
 */
function getRankLevel(points) {
  if (points >= RANK_THRESHOLDS.Platinum) return 'Platinum';
  if (points >= RANK_THRESHOLDS.Gold)     return 'Gold';
  if (points >= RANK_THRESHOLDS.Silver)   return 'Silver';
  return 'Bronze';
}

/**
 * Calculate points earned for a completed job
 * @param {number} rating - 1-5 star rating given by customer
 * @param {boolean} onTime - whether worker arrived on time
 */
function calculateJobPoints(rating, onTime = true) {
  let points = POINT_VALUES.job_completed;
  if (rating === 5)  points += POINT_VALUES.five_star_rating;
  else if (rating === 4) points += POINT_VALUES.four_star_rating;
  if (onTime) points += POINT_VALUES.on_time_arrival;
  return points;
}

/**
 * Compute sort score for job dispatch
 * Higher score = higher priority in dispatch list
 * @param {object} worker - worker row from DB
 */
function dispatchScore(worker) {
  const rankMultiplier = { Bronze: 1, Silver: 1.2, Gold: 1.5, Platinum: 2 };
  const completionFactor = (worker.completion_rate || 100) / 100;
  const pointFactor      = Math.log1p(worker.points || 0);
  const distancePenalty  = worker.distance_km ? Math.max(0, 5 - worker.distance_km) / 5 : 0.5;
  return (rankMultiplier[worker.rank_level] || 1) * completionFactor * (1 + pointFactor) * (1 + distancePenalty);
}

module.exports = { getRankLevel, calculateJobPoints, dispatchScore, RANK_THRESHOLDS, POINT_VALUES };
