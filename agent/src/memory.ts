const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export class AliasMemory {
  private readonly aliases = new Map<string, string>();

  remember(alias: string, address: string) {
    if (!ADDRESS_PATTERN.test(address)) {
      throw new Error(`Invalid address for alias ${alias}: ${address}`);
    }

    this.aliases.set(this.normalize(alias), address);
  }

  resolve(value: string) {
    const normalizedValue = value.trim();
    if (ADDRESS_PATTERN.test(normalizedValue)) {
      return normalizedValue;
    }

    return this.aliases.get(this.normalize(normalizedValue));
  }

  entries() {
    return Object.fromEntries(this.aliases.entries());
  }

  learnFromText(text: string) {
    const learned: Record<string, string> = {};
    const patterns = [
      /(?:remember\s+)?([a-zA-Z][a-zA-Z0-9 _-]{0,40})(?:'s)?\s+address\s+is\s+(0x[a-fA-F0-9]{40})/gi,
      /(?:remember\s+)?([a-zA-Z][a-zA-Z0-9 _-]{0,40})\s+is\s+(0x[a-fA-F0-9]{40})/gi
    ];

    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const alias = match[1].trim();
        const address = match[2];
        this.remember(alias, address);
        learned[this.normalize(alias)] = address;
      }
    }

    return learned;
  }

  private normalize(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }
}

export const defaultAliasMemory = new AliasMemory();

// Stable Hardhat demo aliases used by the dashboard's default prompt.
defaultAliasMemory.remember("Alice", "0x90F79bf6EB2c4f870365E785982E1f101E93b906");
defaultAliasMemory.remember("Bob", "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65");
defaultAliasMemory.remember("Carol", "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc");
