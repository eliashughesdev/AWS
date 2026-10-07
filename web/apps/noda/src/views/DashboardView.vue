<script setup lang="ts">
import PortfolioCard from '../components/PortfolioCard.vue'
import SecurityCard from '../components/SecurityCard.vue'
import AchievementsCard from '../components/AchievementsCard.vue'
import AssetRow from '../components/AssetRow.vue'
import StatCard from '../components/StatCard.vue'
import ActivityItem from '../components/ActivityItem.vue'
import { assets, assetCount, stats, activity } from '../placeholders/dashboard'
</script>

<template>
  <div class="grid gap-[20px] lg:grid-cols-[1fr_392px] lg:gap-[15px]">
    <PortfolioCard />
    <div class="flex flex-col gap-[15px]">
      <SecurityCard />
      <AchievementsCard class="lg:flex-1" />
    </div>
  </div>

  <div class="mt-[29px] flex h-[22px] items-center justify-between lg:mt-[50px] lg:h-[36px]">
    <h2 class="text-[18px] font-medium lg:-mt-[3px] lg:text-[22px] lg:font-semibold">Portfolio Assets</h2>
    <span class="bg-pill grid h-[22px] w-[78px] place-items-center rounded-[8px] border-[0.5px] border-accent text-[10px] font-medium lg:h-[36px] lg:w-[128px] lg:text-[14px]">
      {{ assetCount }}
    </span>
  </div>
  <div class="mt-[20px] space-y-[10px] lg:mt-[28px] lg:space-y-[15px]">
    <AssetRow v-for="asset in assets" :key="asset.symbol" :asset="asset" />
  </div>

  <div class="mt-[26px] grid grid-cols-2 gap-[10px] lg:mt-[30px] lg:grid-cols-4 lg:gap-[15px]">
    <StatCard v-for="stat in stats" :key="stat.label" :stat="stat" />
  </div>

  <section class="mt-[31px] lg:mt-[30px] lg:rounded-[10px] lg:border lg:border-line lg:bg-[#02040E] lg:px-[28px] lg:pb-[29px] lg:pt-[39px]">
    <div class="flex items-center justify-between">
      <h2 class="text-[18px] leading-none font-medium lg:text-[22px] lg:font-[550]">Recent Activity</h2>
      <RouterLink :to="{ name: 'transactions' }" class="text-[12px] leading-none font-medium text-muted max-lg:mt-[5px] lg:text-[18px]">View All</RouterLink>
    </div>
    <div class="mt-[21px] space-y-[10px] lg:mt-[35px] lg:space-y-[15px]">
      <ActivityItem v-for="item in activity" :key="item.kind" :item="item" />
    </div>
  </section>
</template>
