import { shuffled } from './engine.js';

const NAMES = `
Aaron Abel Achim Adam Adrian Agnes Alena Alexander Alexandra Alfred Alina Alma
Amalia Andreas Angela Anika Anja Annalena Annemarie Annika Anton Antonia Armin
Artur Astrid August Axel Bastian Beate Benedikt Benjamin Bernd Bianca Birgit
Björn Bruno Carla Carlotta Carsten Caspar Charlotte Christian Christina Christoph
Clara Claudia Clemens Cornelia Dagmar Daniela David Dennis Dieter Dominik Doris
Dorothea Edda Edith Elke Ella Ellen Elli Elsa Emil Emilia Emma Enno Erika Ernst
Eva Evelin Fabian Falk Felix Ferdinand Finn Florian Frank Franz Franziska Frieda
Friederike Friedrich Fritz Gabriel Georg Gerd Gerda Greta Gretel Gustav Hanna
Hannah Hans Heike Heinrich Helene Helga Hendrik Henning Henri Herbert Hermann
Hilda Holger Ida Ilse Ina Ingrid Irene Iris Isabell Jakob Jan Jana Jannik Jasmin
Jens Joachim Johann Johanna Johannes Jörg Josef Judith Julia Julian Julius Jürgen
Kai Karin Karl Katharina Katja Kilian Kirsten Klaus Konrad Kurt Lara Lars Laura
Lea Lena Lene Leo Leon Leonie Leopold Liesel Lina Lisa Livia Lorenz Lotte
Lotta Luca Lukas Luise Lydia Malte Manfred Mara Marcel Marco Mareike Maria
Marianne Marie Marlene Martin Mathilda Matthias Max Maximilian Meike Mia Michael
Miriam Monika Moritz Nadine Nele Nils Nora Oskar Otto Paula Paul Paulina Peter
Philipp Pia Rainer Ralf Raphaela Renate Robert Rolf Rosa Ruth Sabine Sandra
Sebastian Selma Silke Simon Sonja Sophia Sophie Stefan Stefanie Stella Sven
Svenja Tabea Tanja Theo Thomas Till Timo Tobias Torben Udo Ulf Ulrike Ursula
Ute Valentin Vera Verena Viktoria Vincent Volker Walter Werner Wilma Wolfgang
Yvonne Zoe
`.trim().split(/\s+/u);

export function chooseRivalNames(count, excluded = [], random = Math.random) {
  const used = new Set(excluded.map(name => name.toLowerCase()));
  const candidates = NAMES.filter(name => !used.has(name.toLowerCase()));
  return shuffled(candidates, random).slice(0, count);
}
