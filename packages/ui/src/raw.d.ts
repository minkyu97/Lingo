/** The text of a style sheet, as the bundler hands it over for `?raw`. */
declare module "*.css?raw" {
  const text: string;
  export default text;
}
