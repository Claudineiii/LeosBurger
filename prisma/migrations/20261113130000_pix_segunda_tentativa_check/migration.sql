ALTER TABLE "tentativas_pagamento"
  ADD CONSTRAINT "tentativas_pagamento_segunda_somente_pix_check"
  CHECK ("numero_tentativa" <> 2 OR "metodo" = 'PIX');
