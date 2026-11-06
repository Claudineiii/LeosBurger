export type EnderecoParaGeocodificacao = {
  cep: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  estado: string;
};

export type CandidatoGeocodificado = {
  latitude: number;
  longitude: number;
  enderecoFormatado?: string;
  tipoResultado?: string;
  tipoCorrespondencia?: string;
  confianca?: number;
  numero?: string;
  logradouro?: string;
  bairro?: string;
  cep?: string;
  cidade?: string;
  estado?: string;
  codigoEstado?: string;
  codigoPais?: string;
};

export interface Geocodificador {
  geocodificar(
    endereco: EnderecoParaGeocodificacao,
  ): Promise<CandidatoGeocodificado[]>;
}
