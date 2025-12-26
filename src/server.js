// console messages
const app = require("./app");
console.log("Server file loaded");

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`StudySync API running on http://localhost:${PORT}`);
});
