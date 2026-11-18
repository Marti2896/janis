/** Motivi di esenzione (Natura FatturaPA) selezionabili per le righe con aliquota 0%. */
export const NATURE_OPTIONS: { value: string; label: string }[] = [
  { value: "N4", label: "Esente (art. 10)" },
  { value: "N3.6", label: "Non imponibile" },
  { value: "N2.2", label: "Fuori campo IVA" },
  { value: "N1", label: "Escluso (art. 15)" },
];

export const NATURE_VALUES = NATURE_OPTIONS.map((n) => n.value);
