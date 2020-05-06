import csvParse from 'csv-parse';
import fs from 'fs';
import { getCustomRepository, getRepository, In } from 'typeorm';
import Transaction from '../models/Transaction';
import TransactionsRepository from '../repositories/TransactionsRepository';
import Category from '../models/Category';

interface CSVTransaction {
  title: string;
  type: 'income' | 'outcome';
  value: number;
  category: string;
}

class ImportTransactionsService {
  async execute(filePath: string): Promise<Transaction[]> {
    const contactsReadStream = fs.createReadStream(filePath);
    const transactionsRepository = getCustomRepository(TransactionsRepository);
    const categoriesRepository = getRepository(Category);

    const parses = csvParse({
      from_line: 2,
    });

    const parseCSV = contactsReadStream.pipe(parses);
    const transactions: CSVTransaction[] = [];
    const categories: string[] = [];

    // A cada data que passar vou pegar as constantes recebendo os valores
    parseCSV.on('data', async line => {
      const [title, type, value, category] = line.map((cell: string) =>
        cell.trim(),
      );

      // Se um deles não existir vou retornar
      if (!title || !type || !value) return;

      categories.push(category);
      transactions.push({ title, type, value, category });
    });

    // Quando finalizar o parseCSV então resolve
    await new Promise(resolve => parseCSV.on('end', resolve));

    // Vou verificar se as categorias do array estão no banco de dados
    // Usando o metodo In eu procuro todas as categorias de uma vez
    const existentCategories = await categoriesRepository.find({
      where: {
        title: In(categories),
      },
    });

    // Verifico se alguma categoria do meu array existe no banco de dados,
    // se existir retorno ela
    const existentCategoriesTitles = existentCategories.map(
      (category: Category) => category.title,
    );

    // Primeiro vou verificar as categorias que não estão no banco de dados
    // Depois eu vou retirar as categorias duplicadas, o self é o array de categorias
    // se o value for igual a index ele vai retirar essa categoria.
    // Vou pegar as categorias que não existem no banco e vou criar elas
    const addCategoryTitles = categories
      .filter(category => !existentCategoriesTitles.includes(category))
      .filter((value, index, self) => self.indexOf(value) === index);
    const newCategories = categoriesRepository.create(
      addCategoryTitles.map(title => ({
        title,
      })),
    );

    // vou salvar no banco as novas categorias
    await categoriesRepository.save(newCategories);

    // No meu finalCategoris vai conter todas as novas categorias e as que já existiam
    const finalCategories = [...newCategories, ...existentCategories];

    // Criar as transações, para cada transação que nós temos no array,
    // vou pegar o transaction e retornar o objeto,
    // e quando minha category.title for igual a transaction.category
    // então vou atribuila ao category.
    const createdTransactions = transactionsRepository.create(
      transactions.map(transaction => ({
        title: transaction.title,
        type: transaction.type,
        value: transaction.value,
        category: finalCategories.find(
          category => category.title === transaction.category,
        ),
      })),
    );

    // Vou salvar no banco as novas transactions
    await transactionsRepository.save(createdTransactions);

    // Vou excluir o arquivo
    await fs.promises.unlink(filePath);

    return createdTransactions;
  }
}

export default ImportTransactionsService;
