function httpsUrl(value) {
  return typeof value === "string" && /^https:\/\//i.test(value) ? value : null;
}
