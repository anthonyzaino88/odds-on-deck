/**
 * Base Repository
 * 
 * Provides common database operations for all repositories.
 * Extend this class to create specific repositories.
 */

export class BaseRepository {
  constructor(prisma, modelName) {
    this.db = prisma
    this.modelName = modelName
    this.model = prisma[modelName]
  }

  /**
   * Find one record by ID
   */
  async findById(id, include = {}) {
    try {
      return await this.model.findUnique({
        where: { id },
        include
      })
    } catch (error) {
      console.error(`❌ Error finding ${this.modelName} by ID:`, error)
      throw error
    }
  }

  /**
   * Find all records matching criteria
   */
  async findMany(where = {}, options = {}) {
    try {
      return await this.model.findMany({
        where,
        ...options
      })
    } catch (error) {
      console.error(`❌ Error finding ${this.modelName}:`, error)
      throw error
    }
  }

  /**
   * Find first record matching criteria
   */
  async findFirst(where = {}, options = {}) {
    try {
      return await this.model.findFirst({
        where,
        ...options
      })
    } catch (error) {
      console.error(`❌ Error finding first ${this.modelName}:`, error)
      throw error
    }
  }

  /**
   * Create a new record
   */
  async create(data) {
    try {
      return await this.model.create({ data })
    } catch (error) {
      console.error(`❌ Error creating ${this.modelName}:`, error)
      throw error
    }
  }

  /**
   * Update a record
   */
  async update(id, data) {
    try {
      return await this.model.update({
        where: { id },
        data
      })
    } catch (error) {
      console.error(`❌ Error updating ${this.modelName}:`, error)
      throw error
    }
  }

  /**
   * Upsert (update or insert)
   */
  async upsert(where, update, create) {
    try {
      return await this.model.upsert({
        where,
        update,
        create
      })
    } catch (error) {
      console.error(`❌ Error upserting ${this.modelName}:`, error)
      throw error
    }
  }

  /**
   * Delete a record
   */
  async delete(id) {
    try {
      return await this.model.delete({
        where: { id }
      })
    } catch (error) {
      console.error(`❌ Error deleting ${this.modelName}:`, error)
      throw error
    }
  }

  /**
   * Count records
   */
  async count(where = {}) {
    try {
      return await this.model.count({ where })
    } catch (error) {
      console.error(`❌ Error counting ${this.modelName}:`, error)
      throw error
    }
  }

  /**
   * Execute a transaction
   */
  async transaction(operations) {
    try {
      return await this.db.$transaction(operations)
    } catch (error) {
      console.error(`❌ Transaction failed for ${this.modelName}:`, error)
      throw error
    }
  }
}


