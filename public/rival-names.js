import { shuffled } from './engine.js';

const BY_VOICE = {
  male: `
    Aaron Abel Achim Adam Adrian Alexander Alfred Andreas Anton Armin Artur August
    Axel Bastian Benedikt Benjamin Bernd Björn Bruno Carsten Caspar Christian
    Christoph Clemens David Dennis Dieter Dominik Emil Enno Ernst Fabian Falk Felix
    Ferdinand Finn Florian Frank Franz Friedrich Fritz Gabriel Georg Gerd Gustav
    Hans Heinrich Hendrik Henning Henri Herbert Hermann Holger Jakob Jan Jannik Jens
    Joachim Johann Johannes Jörg Josef Julian Julius Jürgen Kai Karl Kilian Klaus
    Konrad Kurt Lars Leo Leon Leopold Lorenz Luca Lukas Malte Manfred Marcel Marco
    Martin Matthias Max Maximilian Michael Moritz Nils Oskar Otto Paul Peter Philipp
    Rainer Ralf Robert Rolf Sebastian Simon Stefan Sven Theo Thomas Till Timo Tobias
    Torben Udo Ulf Valentin Vincent Volker Walter Werner Wolfgang
  `.trim().split(/\s+/u),
  female: `
    Agnes Alena Alexandra Alina Alma Amalia Angela Anika Anja Annalena Annemarie
    Annika Antonia Astrid Beate Bianca Birgit Carla Carlotta Charlotte Christina
    Clara Claudia Cornelia Dagmar Daniela Doris Dorothea Edda Edith Elke Ella Ellen
    Elli Elsa Emilia Emma Erika Eva Evelin Franziska Frieda Friederike Gerda Greta
    Gretel Hanna Hannah Heike Helene Helga Hilda Ida Ilse Ina Ingrid Irene Iris
    Isabell Jana Jasmin Johanna Judith Julia Karin Katharina Katja Kirsten Lara
    Laura Lea Lena Lene Leonie Liesel Lina Lisa Livia Lotte Lotta Luise Lydia Mara
    Mareike Maria Marianne Marie Marlene Mathilda Meike Mia Miriam Monika Nadine
    Nele Nora Paula Paulina Pia Raphaela Renate Rosa Ruth Sabine Sandra Selma Silke
    Sonja Sophia Sophie Stefanie Stella Svenja Tabea Tanja Ulrike Ursula Ute Vera
    Verena Viktoria Wilma Yvonne Zoe
  `.trim().split(/\s+/u),
};
const voices = new Map(Object.entries(BY_VOICE).flatMap(([voice, names]) =>
  names.map(name => [name.toLowerCase(), voice])));
const NAMES = Object.values(BY_VOICE).flat();

export function voiceForName(name) {
  return voices.get(name.trim().toLowerCase());
}

export function chooseRivalNames(count, excluded = [], random = Math.random) {
  const used = new Set(excluded.map(name => name.toLowerCase()));
  const candidates = NAMES.filter(name => !used.has(name.toLowerCase()));
  return shuffled(candidates, random).slice(0, count);
}
