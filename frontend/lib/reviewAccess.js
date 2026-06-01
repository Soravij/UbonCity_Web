export function buildReviewAccessCookieName(reviewId) {
  const id = Number(reviewId || 0) || 0;
  return id > 0 ? `review_access_${id}` : "review_access_invalid";
}

