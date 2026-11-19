# Dashboard Med Fluency

Dashboard mensal que consolida Meta Ads (CA01 e CA02), vendas/faturamento e agendamento/atendimento.

## Fontes

- Meta Ads: contas `CA01 - Med Fluency Academy` e `CA02 - Med Fluency Academy`.
- Vendas: aba `LEADS VENDAS` da planilha fixa de análise.
- Agendamento: abas diárias (`01/11`, `02/11`...) da planilha mensal.

O agrupamento usa `família + localidade`, por exemplo `MÉDICOS|CURITIBA` e `SAÚDE|SALVADOR`. O nome original da campanha continua disponível para busca.

## Configuração na Vercel

1. Crie uma Service Account no Google Cloud e habilite a Google Sheets API.
2. Compartilhe as duas planilhas com o e-mail da Service Account como **Leitor**.
3. Cadastre as variáveis em `.env.example` no projeto da Vercel. Nunca publique a chave no GitHub.
4. Para trocar a planilha de agendamento no mês seguinte, adicione `APPOINTMENT_SHEET_ID_2026_12` com o ID da nova planilha. A planilha de vendas permanece a mesma.
5. Para alterar a regra de classificação, edite os dois conjuntos de palavras-chave de status na Vercel.

## Desenvolvimento

O projeto não exige dependências de execução:

```bash
npm test
```

Para publicar: crie um repositório GitHub, envie esta pasta e importe o repositório na Vercel. A cada push na branch principal, a Vercel fará o deploy automaticamente.

> A instância de validação pode usar um snapshot protegido no ambiente da Vercel; os dados operacionais não ficam no repositório.
